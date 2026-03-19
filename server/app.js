const express = require("express");
const cookieParser = require("cookie-parser");
const cors = require("cors");

const healthRouter        = require("./routes/health");
const authRouter          = require("./routes/auth");
const usersRouter         = require("./routes/users");
const conversationsRouter = require("./routes/conversations");
const messagesRouter      = require("./routes/messages");

const app = express();

app.use(cors({
  origin:      process.env.CLIENT_ORIGIN || "http://localhost:5173",
  credentials: true,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use("/health",        healthRouter);
app.use("/auth",          authRouter);
app.use("/users",         usersRouter);
app.use("/conversations", conversationsRouter);
app.use("/messages",      messagesRouter);

module.exports = app;
