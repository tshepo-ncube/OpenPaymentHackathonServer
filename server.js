import {
  createAuthenticatedClient,
  isFinalizedGrant,
  OpenPaymentsClientError,
  isPendingGrant,
} from "@interledger/open-payments";
import config from "./config.js";
import express from "express";
import cors from "cors";
import { randomUUID } from "crypto";

import twilio from "twilio";

const NONCE = randomUUID();

const app = express();
const port = 3040;

app.use(express.json());

app.use(
  cors({
    origin: "http://localhost:3000", // allow requests from this origin
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
  })
);

function sendMessage(msg, receiverNumber) {
  const accountSid = config.accountSid;
  const authToken = config.authToken;
  const client = twilio(accountSid, authToken);
  client.messages
    .create({
      //body: 'Would you like to receive _Positive Vibes_ 😄✨🌈?',
      body: `*Message from OpenTuition Recipient*: ${msg} \n\n _You can opt out of receiving recipient messages on your OpenTuition Profile_`,
      //body: 'Hi Tshepo',
      from: "whatsapp:+27612074607",
      //to: "whatsapp:+27634429008",
      to: "whatsapp:+27615206440",
    })
    .then((message) => console.log(message.sid));
}

// Endpoint to handle the finish redirect
app.get("/finish", async (req, res) => {
  console.log("FINISH");
  //console.log(req);
  //const { code, state } = req.query;

  // Validate the code and state (optional, but recommended)

  // Retrieve the necessary details to complete the interaction
  //const { CONTINUE_ACCESS_TOKEN, CONTINUE_URI } = req.session; // Use a session or database to store these temporarily

  //console.log(CONTINUE_ACCESS_TOKEN, CONTINUE_URI);

  // Notify the client that the interaction is complete (e.g., using WebSockets, or storing the status in a database)
  res.send("Payment interaction completed successfully.");
});

// Define another route
app.post("/start_one_time_payment", async (req, res) => {
  const { senderWalletUrl, contribution, studentURL, studentID } = req.body;

  if (!senderWalletUrl) {
    return res.status(400).json({ error: "sendingWalletAddress is required" });
  }

  // Process the sendingWalletAddress as needed
  console.log("Received sendingWalletAddressURL:", senderWalletUrl);
  console.log("Received contribution:", contribution);

  const client = await createAuthenticatedClient({
    walletAddressUrl: config.CLIENT_WALLET_ADDRESS_URL,
    keyId: config.KEY_ID,
    privateKey: config.PRIVATE_KEY_PATH,
    validateResponses: false, // Use this flag if you are having issues with the yaml files of the repo
  });

  const receivingWalletAddress = await client.walletAddress.get({
    url: config.RECEIVING_WALLET_ADDRESS_URL,
  });
  //const { SENDING_WALLET_ADDRESS_URL_ } = req.body;
  const sendingWalletAddress = await client.walletAddress.get({
    url: senderWalletUrl,
  });

  console.log(
    "Got wallet addresses. We will set up a payment between the sending and the receiving wallet address",
    { receivingWalletAddress, sendingWalletAddress }
  );

  // Step 1: Get a grant for the incoming payment, so we can create the incoming payment on the receiving wallet address
  const incomingPaymentGrant = await client.grant.request(
    {
      url: receivingWalletAddress.authServer,
    },
    {
      access_token: {
        access: [
          {
            type: "incoming-payment",
            actions: ["read", "complete", "create"],
          },
        ],
      },
    }
  );

  if (isPendingGrant(incomingPaymentGrant)) {
    throw new Error("Expected non-interactive grant");
  }

  console.log(
    "\nStep 1: got incoming payment grant for receiving wallet address",
    incomingPaymentGrant
  );

  // Step 2: Create the incoming payment. This will be where funds will be received.
  const incomingPayment = await client.incomingPayment.create(
    {
      url: receivingWalletAddress.resourceServer,
      accessToken: incomingPaymentGrant.access_token.value,
    },
    {
      walletAddress: receivingWalletAddress.id,
      incomingAmount: {
        value: `${contribution * 100}`,
        assetCode: receivingWalletAddress.assetCode,
        assetScale: receivingWalletAddress.assetScale,
      },
      metadata: {
        description: `Payment For -  Student ID : ${studentID}`,
      },
      expiresAt: new Date(Date.now() + 60_000 * 10).toISOString(),
    }
  );

  console.log(
    "\nStep 2: created incoming payment on receiving wallet address",
    incomingPayment
  );

  // Step 3: Get a quote grant, so we can create a quote on the sending wallet address
  const quoteGrant = await client.grant.request(
    {
      url: sendingWalletAddress.authServer,
    },
    {
      access_token: {
        access: [
          {
            type: "quote",
            actions: ["read", "create"],
          },
        ],
      },
    }
  );

  if (isPendingGrant(quoteGrant)) {
    throw new Error("Expected non-interactive grant");
  }

  console.log(
    "\nStep 3: got quote grant on sending wallet address",
    quoteGrant
  );

  // Step 4: Create a quote, this gives an indication of how much it will cost to pay into the incoming payment
  const quote = await client.quote.create(
    {
      url: sendingWalletAddress.resourceServer,
      accessToken: quoteGrant.access_token.value,
    },
    {
      method: "ilp",
      walletAddress: sendingWalletAddress.id,
      receiver: incomingPayment.id,
    }
  );

  console.log("\nStep 4: got quote on sending wallet address", quote);

  // Step 5: Start the grant process for the outgoing payments.
  // This is an interactive grant: the user (in this case, you) will need to accept the grant by navigating to the outputted link.
  const outgoingPaymentGrant = await client.grant.request(
    {
      url: sendingWalletAddress.authServer,
    },
    {
      access_token: {
        access: [
          {
            identifier: sendingWalletAddress.id,
            type: "outgoing-payment",
            actions: ["read", "read-all", "create"],
            limits: {
              debitAmount: quote.debitAmount,
            },
          },
        ],
      },
      interact: {
        start: ["redirect"],
        finish: {
          method: "redirect",
          uri: studentURL,
          nonce: NONCE,
        },
      },
    }
  );

  if (!isPendingGrant(outgoingPaymentGrant)) {
    throw new Error("Expected interactive grant");
  }

  console.log(
    "\nStep 5: got pending outgoing payment grant",
    outgoingPaymentGrant
  );

  // We need the following variables in the step-2.js script,
  // make sure to save them in step-2.js, as we need them to create the outgoing payment
  console.log("\nSave the following in the step-2.js script:");
  console.log("QUOTE_URL:", quote.id);
  console.log("CONTINUE_URI:", outgoingPaymentGrant.continue.uri);
  console.log(
    "CONTINUE_ACCESS_TOKEN:",
    outgoingPaymentGrant.continue.access_token.value
  );

  console.log(
    "\nAnd then navigate to the following URL, to accept the interaction from the sending wallet:"
  );

  console.log(outgoingPaymentGrant.interact.redirect);
  console.log("\nAfter that is done, run `node step-2.js`");

  // Store the details in session
  //   req.session.CONTINUE_ACCESS_TOKEN =
  //     outgoingPaymentGrant.continue.access_token.value;
  //   req.session.CONTINUE_URI = outgoingPaymentGrant.continue.uri;
  //   req.session.QUOTE_URL = quote.id;
  //   req.session.INTERACT_URL = outgoingPaymentGrant.interact.redirect;

  res.json({
    INTERACT_URL: outgoingPaymentGrant.interact.redirect,
    QUOTE_URL: quote.id,
    CONTINUE_URI: outgoingPaymentGrant.continue.uri,
    CONTINUE_ACCESS_TOKEN: outgoingPaymentGrant.continue.access_token.value,
  });
});

app.post("/finish_one_time_payment", async (req, res) => {
  const {
    quoteUrl,
    continueUri,
    continueAccessToken,
    interactRef,
    sendingWalletAddressUrl,
    msg,
  } = req.body;

  // Log the received data
  console.log("Received data at /finish_payment:", {
    quoteUrl,
    continueUri,
    continueAccessToken,
  });

  const client = await createAuthenticatedClient({
    walletAddressUrl: config.CLIENT_WALLET_ADDRESS_URL,
    keyId: config.KEY_ID,
    privateKey: config.PRIVATE_KEY_PATH,
    validateResponses: false,
  });

  const sendingWalletAddress = await client.walletAddress.get({
    url: config.SENDING_WALLET_ADDRESS_URL,
  });

  // Step 6: Check if the interactive grant was accepted.
  // If it was, this will return an access token which we can use to create the outgoing payment.
  let finalizedOutgoingPaymentGrant;

  try {
    finalizedOutgoingPaymentGrant = await client.grant.continue(
      {
        accessToken: continueAccessToken,
        url: continueUri,
      },
      {
        interact_ref: interactRef,
      }
    );
  } catch (err) {
    if (err instanceof OpenPaymentsClientError && err.status === 401) {
      console.log(
        "\nThere was an error continuing the grant. You probably have not accepted the grant at the url (or it has already been used up, in which case, you can just rerun the first script)."
      );
    }
    return;
  }
  sendMessage(msg, "");
  if (!isFinalizedGrant(finalizedOutgoingPaymentGrant)) {
    throw new Error(
      "Expected finalized grant. Probably the interaction from the previous script was not accepted, or the grant was already used."
    );
  }

  console.log(
    "\nStep 6: Got finalized outgoing payment grant",
    finalizedOutgoingPaymentGrant
  );

  // Step 7: Finally, create the outgoing payment on the sending wallet address.
  // This will make a payment from the outgoing payment to the incoming one (over ILP)
  const outgoingPayment = await client.outgoingPayment.create(
    {
      url: sendingWalletAddress.resourceServer,
      accessToken: finalizedOutgoingPaymentGrant.access_token.value,
    },
    {
      walletAddress: sendingWalletAddress.id,
      quoteId: quoteUrl,
    }
  );
  console.log(
    "\nStep 7: Created outgoing payment. Funds will now move from the outgoing payment to the incoming payment.",
    outgoingPayment
  );

  // Respond to the client
  res.json({ message: "Payment Complete successfully" });
});

app.post("/start_recurring_payments", async (req, res) => {
  const { senderWalletUrl, contribution, studentURL, studentID } = req.body;
  if (!senderWalletUrl) {
    return res.status(400).json({ error: "sendingWalletAddress is required" });
  }

  // Process the sendingWalletAddress as needed
  console.log("Received sendingWalletAddressURL:", senderWalletUrl);
  console.log("Received contribution:", contribution);

  const client = await createAuthenticatedClient({
    walletAddressUrl: config.CLIENT_WALLET_ADDRESS_URL,
    keyId: config.KEY_ID,
    privateKey: config.PRIVATE_KEY_PATH,
    validateResponses: false, // Use this flag if you are having issues with the yaml files of the repo
  });

  const receivingWalletAddress = await client.walletAddress.get({
    url: config.RECEIVING_WALLET_ADDRESS_URL,
  });

  const sendingWalletAddress = await client.walletAddress.get({
    url: senderWalletUrl,
  });

  const incomingPaymentGrant = await client.grant.request(
    {
      url: receivingWalletAddress.authServer,
    },
    {
      access_token: {
        access: [
          {
            type: "incoming-payment",
            actions: ["read", "complete", "create"],
          },
        ],
      },
    }
  );

  if (isPendingGrant(incomingPaymentGrant)) {
    throw new Error("Expected non-interactive grant");
  }

  const incomingPayment = await client.incomingPayment.create(
    {
      url: receivingWalletAddress.resourceServer,
      accessToken: incomingPaymentGrant.access_token.value,
    },
    {
      walletAddress: receivingWalletAddress.id,
      incomingAmount: {
        value: "200",
        assetCode: receivingWalletAddress.assetCode,
        assetScale: receivingWalletAddress.assetScale,
      },
      metadata: {
        description: `Donation for STUDENT : ${studentID}`,
      },
      expiresAt: new Date(Date.now() + 60_000 * 10).toISOString(),
    }
  );

  const quoteGrant = await client.grant.request(
    {
      url: sendingWalletAddress.authServer,
    },
    {
      access_token: {
        access: [
          {
            type: "quote",
            actions: ["create", "read", "read-all"],
          },
        ],
      },
    }
  );

  if (isPendingGrant(quoteGrant)) {
    throw new Error("Expected non-interactive grant");
  }

  console.log("got quote grant on sending wallet address", quoteGrant);
  const quote = await client.quote.create(
    {
      url: sendingWalletAddress.resourceServer,
      accessToken: quoteGrant.access_token.value,
    },
    {
      method: "ilp",
      walletAddress: sendingWalletAddress.id,
      receiver: incomingPayment.id,
    }
  );

  const outgoingPaymentPendingGrant = await client.grant.request(
    {
      url: sendingWalletAddress.authServer,
    },
    {
      access_token: {
        access: [
          {
            identifier: sendingWalletAddress.id,
            type: "outgoing-payment",
            actions: ["list", "list-all", "read", "read-all", "create"],
            limits: {
              debitAmount: quote.debitAmount,
              interval: "R/2024-06-14T08:00:00Z/P1M",
            },
          },
        ],
      },
      interact: {
        start: ["redirect"],
        finish: {
          method: "redirect",
          uri: studentURL,
          nonce: NONCE,
        },
      },
    }
  );
  if (!isPendingGrant(outgoingPaymentPendingGrant)) {
    throw new Error("Expected interactive grant");
  }

  console.log(
    "\nStep 5: got pending outgoing payment grant",
    outgoingPaymentPendingGrant
  );
  console.log("\nSave the following in the step-2.js script:");
  console.log("QUOTE_URL:", quote.id);
  console.log("CONTINUE_URI:", outgoingPaymentPendingGrant.continue.uri);
  console.log(
    "CONTINUE_ACCESS_TOKEN:",
    outgoingPaymentPendingGrant.continue.access_token.value
  );

  res.json({
    INTERACT_URL: outgoingPaymentPendingGrant.interact.redirect,
    QUOTE_URL: quote.id,
    CONTINUE_URI: outgoingPaymentPendingGrant.continue.uri,
    CONTINUE_ACCESS_TOKEN:
      outgoingPaymentPendingGrant.continue.access_token.value,
  });
});

app.post("/finish_recurring_payments", async (req, res) => {
  const {
    quoteUrl,
    continueUri,
    continueAccessToken,
    interactRef,
    sendingWalletAddressUrl,
  } = req.body;

  // Log the received data
  console.log("Received data at /finish_recurring_payments:", {
    quoteUrl,
    continueUri,
    continueAccessToken,
    msg,
  });

  const CONTINUE_ACCESS_TOKEN = continueAccessToken;
  const INTERACT_URL = interactRef;
  const QUOTE_ID = quoteUrl;
  const CONTINUE_URI = continueUri;

  const client = await createAuthenticatedClient({
    walletAddressUrl: config.CLIENT_WALLET_ADDRESS_URL,
    keyId: config.KEY_ID,
    privateKey: config.PRIVATE_KEY_PATH,
    validateResponses: false,
  });

  const sendingWalletAddress = await client.walletAddress.get({
    url: config.SENDING_WALLET_ADDRESS_URL,
  });

  let finalizedOutgoingPaymentGrant;

  // finalizedOutgoingPaymentGrant = await client.grant.continue(
  //   {
  //     accessToken: CONTINUE_ACCESS_TOKEN,
  //     url: CONTINUE_URI,
  //   },
  //   {
  //     interact_ref: interactRef,
  //   }
  // );

  try {
    finalizedOutgoingPaymentGrant = await client.grant.continue(
      {
        accessToken: continueAccessToken,
        url: continueUri,
      },
      {
        interact_ref: interactRef,
      }
    );
  } catch (err) {
    if (err instanceof OpenPaymentsClientError && err.status === 401) {
      console.log(
        "\nThere was an error continuing the grant. You probably have not accepted the grant at the url (or it has already been used up, in which case, you can just rerun the first script)."
      );
    }
    return;
  }

  console.log(finalizedOutgoingPaymentGrant);

  const access_tokk = finalizedOutgoingPaymentGrant.access_token.value;
  console.log(access_tokk);
  console.log(finalizedOutgoingPaymentGrant.access_token.value);
  const outgoingPayment = await client.outgoingPayment.create(
    {
      url: sendingWalletAddress.resourceServer,
      accessToken: access_tokk,
    },
    {
      walletAddress: sendingWalletAddress.id,
      quoteId: quoteUrl,
    }
  );

  sendMessage(msg, "");
});

// Start the server
app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
