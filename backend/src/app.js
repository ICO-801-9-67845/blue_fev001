import cors from "cors";
import express from "express";
import { FRONTEND_ORIGINS } from "./config/env.js";
import authRoutes from "./routes/authRoutes.js";
import chatRoutes from "./routes/chatRoutes.js";
import analyticsRoutes from "./routes/analyticsRoutes.js";
import adminAnalyticsRoutes from "./routes/adminAnalyticsRoutes.js";
import { errorHandler, notFoundHandler } from "./middlewares/errorMiddleware.js";

const app = express();

app.use(
  cors({
    origin(origin, callback) {
      callback(null, !origin || FRONTEND_ORIGINS.includes(origin));
    },
    credentials: true,
  }),
);
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_request, response) => {
  response.json({ success: true, message: "API running" });
});

app.use("/api/auth", authRoutes);
app.use("/api/chats", chatRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/admin/analytics", adminAnalyticsRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
