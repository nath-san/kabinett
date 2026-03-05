import { PassThrough } from "node:stream";

import type { AppLoadContext, EntryContext } from "react-router";
import { createReadableStreamFromReadable } from "@react-router/node";
import { ServerRouter } from "react-router";
import { isbot } from "isbot";
import type { RenderToPipeableStreamOptions } from "react-dom/server";
import { renderToPipeableStream } from "react-dom/server";
import {
  installServerFetchInstrumentation,
  logRequestComplete,
  logRequestError,
  logRequestShell,
  logRequestStart,
  nowMs,
} from "./lib/perf.server";

installServerFetchInstrumentation();

// Pre-warm the discover page cache after server starts
setTimeout(() => {
  const origin = "http://localhost:3000";
  Promise.all([
    fetch(`${origin}/`).then(() => console.log("[Warmup] Home cached")),
    fetch(`${origin}/discover`).then(() => console.log("[Warmup] Discover cached")),
    fetch(`${origin}/om`).then(() => console.log("[Warmup] Om cached")),
    fetch(`${origin}/timeline`).then(() => console.log("[Warmup] Timeline cached")),
  ]).catch(() => {});
}, 5000);

export const streamTimeout = 5_000;
let requestSequence = 0;

export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  loadContext: AppLoadContext,
  // If you have middleware enabled:
  // loadContext: RouterContextProvider
) {
  const requestId = ++requestSequence;
  const startMs = nowMs();
  const url = new URL(request.url);
  logRequestStart({
    requestId,
    method: request.method.toUpperCase(),
    path: url.pathname,
    search: url.search || "",
    userAgent: request.headers.get("user-agent") || "",
  });

  // https://httpwg.org/specs/rfc9110.html#HEAD
  if (request.method.toUpperCase() === "HEAD") {
    const durationMs = nowMs() - startMs;
    logRequestComplete({
      requestId,
      method: "HEAD",
      path: url.pathname,
      status: responseStatusCode,
      durationMs: Math.round(durationMs * 100) / 100,
      shellMs: 0,
      head: true,
    });
    return new Response(null, {
      status: responseStatusCode,
      headers: responseHeaders,
    });
  }

  return new Promise((resolve, reject) => {
    let shellRendered = false;
    let userAgent = request.headers.get("user-agent");

    // Ensure requests from bots and SPA Mode renders wait for all content to load before responding
    // https://react.dev/reference/react-dom/server/renderToPipeableStream#waiting-for-all-content-to-load-for-crawlers-and-static-generation
    let readyOption: keyof RenderToPipeableStreamOptions =
      (userAgent && isbot(userAgent)) || routerContext.isSpaMode
        ? "onAllReady"
        : "onShellReady";

    // Abort the rendering stream after the `streamTimeout` so it has time to
    // flush down the rejected boundaries
    let timeoutId: ReturnType<typeof setTimeout> | undefined = setTimeout(
      () => abort(),
      streamTimeout + 1000,
    );

    const { pipe, abort } = renderToPipeableStream(
      <ServerRouter context={routerContext} url={request.url} />,
      {
        [readyOption]() {
          shellRendered = true;
          const shellMs = nowMs() - startMs;
          const serverTimingValue = responseHeaders.get("Server-Timing");
          const timingPart = `ssr_shell;dur=${(Math.round(shellMs * 100) / 100).toFixed(2)}`;
          responseHeaders.set(
            "Server-Timing",
            serverTimingValue ? `${serverTimingValue}, ${timingPart}` : timingPart,
          );

          logRequestShell({
            requestId,
            method: request.method.toUpperCase(),
            path: url.pathname,
            status: responseStatusCode,
            shellMs: Math.round(shellMs * 100) / 100,
            ready: readyOption,
          });

          const body = new PassThrough({
            final(callback) {
              const durationMs = nowMs() - startMs;
              logRequestComplete({
                requestId,
                method: request.method.toUpperCase(),
                path: url.pathname,
                status: responseStatusCode,
                durationMs: Math.round(durationMs * 100) / 100,
                shellMs: Math.round(shellMs * 100) / 100,
              });

              // Clear the timeout to prevent retaining the closure and memory leak
              clearTimeout(timeoutId);
              timeoutId = undefined;
              callback();
            },
          });
          const stream = createReadableStreamFromReadable(body);

          responseHeaders.set("Content-Type", "text/html");

          pipe(body);

          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            }),
          );
        },
        onShellError(error: unknown) {
          logRequestError({
            requestId,
            method: request.method.toUpperCase(),
            path: url.pathname,
            stage: "onShellError",
            error: error instanceof Error ? error.message : String(error),
          });
          reject(error);
        },
        onError(error: unknown) {
          responseStatusCode = 500;
          logRequestError({
            requestId,
            method: request.method.toUpperCase(),
            path: url.pathname,
            stage: "onError",
            error: error instanceof Error ? error.message : String(error),
          });
          // Log streaming rendering errors from inside the shell.  Don't log
          // errors encountered during initial shell rendering since they'll
          // reject and get logged in handleDocumentRequest.
          if (shellRendered) {
            console.error(error);
          }
        },
      },
    );
  });
}
