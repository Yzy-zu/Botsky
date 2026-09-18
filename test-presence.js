require('dotenv').config();
const { sendTyping } = require('./src/services/evolution');
sendTyping("5214435810175").then(() => console.log("Done")).catch(console.error);
