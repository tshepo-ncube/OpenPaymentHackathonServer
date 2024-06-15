# Open Payments Example Script

These two scripts send money between two wallet addresses, using the [Open Payments client](https://github.com/interledger/open-payments/tree/main/packages/open-payments).

`step-1.js` creates an incoming payment on the receiving wallet address, and a quote on the sending wallet address (after getting grants for both). It also creates an interactive outgoing payment grant, which will require user interaction.

`step-2.js` finalizes the grant (after accepting it, via the URL), and creates the outgoing payment.

### Steps

1. Make sure you have NodeJS installed
2. Run `npm install`
3. Get a private key, client wallet address and keyId from the [test wallet](https://rafiki.money), and add them to `config.js`
4. Pick a receiving wallet address, and a sending wallet address.
5. Run `node step-1.js`
6. Copy `QUOTE_URL` `CONTINUE_URI` `CONTINUE_ACCESS_TOKEN` into `step-2.js` script.
7. Click on the outputted URL, to accept the outgoing payment grant.
8. Run `node step-2.js`. This will create the outgoing payment, and move the funds between the sending wallet address, and the receiving one!
