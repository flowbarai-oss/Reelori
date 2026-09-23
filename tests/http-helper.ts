import http from "node:http";
export function client(server: http.Server) {
  const port = (server.address() as { port: number }).port;
  let cookie = "";
  return async (route: string, body?: unknown) =>
    new Promise<{
      status: number;
      data: any;
      bytes: Buffer;
      headers: http.IncomingHttpHeaders;
    }>((resolve, reject) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path: route,
          method: body === undefined ? "GET" : "POST",
          headers: {
            Host: "127.0.0.1:4311",
            Origin: "http://127.0.0.1:5178",
            Cookie: cookie,
            "Content-Type": "application/json",
          },
        },
        (res) => {
          if (res.headers["set-cookie"])
            cookie = res.headers["set-cookie"][0].split(";")[0];
          const chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            const bytes = Buffer.concat(chunks);
            let data;
            try {
              data = JSON.parse(bytes.toString());
            } catch {
              data = null;
            }
            resolve({
              status: res.statusCode!,
              data,
              bytes,
              headers: res.headers,
            });
          });
        },
      );
      req.on("error", reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
}
