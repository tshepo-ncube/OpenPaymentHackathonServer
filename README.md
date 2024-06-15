# Payment Processing Server

This is a Node.js server for handling one-time and recurring payments using the Interledger Open Payments API. It includes endpoints for starting and finishing payments, as well as sending WhatsApp notifications to Donors via Twilio.
The code for the server is at server.js.
We acknowledge the security risk that leaving our Twilio and Wallet keys on this repository. It's only for time purposes for you guys :)

## Prerequisites

- Node.js installed
- npm (Node Package Manager) installed

## Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/tshepo-ncube/OpenPaymentHackathonServer.git
   cd OpenPaymentHackathonServer
2. Run `npm install`
3. If you testing that we didnt hardcode any values :), you could get a private key, client wallet address and keyId from the [test wallet](https://rafiki.money), and add them to `config.js`. If not, you can proceed to step 4.
4. Run 'node server.js'


