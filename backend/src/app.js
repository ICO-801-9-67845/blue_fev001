import cors from "cors";
import express from "express";
import { FRONTEND_URL } from "./config/env.js";
import authRoutes from "./routes/authRoutes.js";
import chatRoutes from "./routes/chatRoutes.js";
import { errorHandler, notFoundHandler } from "./middlewares/errorMiddleware.js";

const app = express();

app.use(
  cors({
    origin: FRONTEND_URL,
    credentials: true,
  }),
);
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_request, response) => {
  response.json({ success: true, message: "API running" });
});

app.use("/api/auth", authRoutes);
app.use("/api/chats", chatRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
