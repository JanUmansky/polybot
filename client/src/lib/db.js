import dotenv from "dotenv";
import { resolve } from "path";
import mongoose from "mongoose";

dotenv.config({ path: resolve(process.cwd(), "../.env") });

const uri = process.env.MONGODB_URI;
if (!uri) {
  throw new Error("MONGODB_URI is not defined in environment variables");
}

const options = {
  maxPoolSize: 10,
  bufferCommands: false,
};

let cached = global._mongooseConnection;

if (!cached) {
  cached = global._mongooseConnection = { promise: null };
}

export async function connectDb() {
  if (cached.promise) return cached.promise;

  cached.promise = mongoose.connect(uri, options);
  return cached.promise;
}
