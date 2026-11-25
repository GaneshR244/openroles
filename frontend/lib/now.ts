import { io } from "next/cache";

/**
 * The current time, read at request time. With Cache Components, `io()` keeps
 * the clock read (and everything after it) out of prerendered output.
 */
export async function requestNow(): Promise<number> {
  await io();
  return Date.now();
}
