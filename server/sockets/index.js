const connectionHandler = require("./handlers/connection");
const messageHandler = require("./handlers/message");
const conversationHandler = require("./handlers/conversation");

function registerSocketHandlers(io) {
  io.on("connection", (socket) => {
    connectionHandler(io, socket);
    messageHandler(io, socket);
    conversationHandler(io, socket);
  });
}

module.exports = registerSocketHandlers;
