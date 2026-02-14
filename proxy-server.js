const http = require("http");
const https = require("https");
const url = require("url");

const PORT = 3001;
const TARGET = "https://rule34vault.com";

const server = http.createServer((req, res) => {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, PATCH");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept");
  res.setHeader("Access-Control-Max-Age", "86400");

  // Handle preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsed = url.parse(req.url);
  const targetUrl = `${TARGET}${parsed.path}`;

  const options = {
    method: req.method,
    headers: { ...req.headers, host: "rule34vault.com" },
  };
  delete options.headers["origin"];
  delete options.headers["referer"];

  const proxyReq = https.request(targetUrl, options, (proxyRes) => {
    // Copy status and headers, override CORS
    const headers = { ...proxyRes.headers };
    headers["access-control-allow-origin"] = "*";
    delete headers["x-frame-options"];
    res.writeHead(proxyRes.statusCode, headers);
    proxyRes.pipe(res);
  });

  proxyReq.on("error", (err) => {
    console.error("Proxy error:", err.message);
    res.writeHead(502);
    res.end("Proxy error");
  });

  req.pipe(proxyReq);
});

server.listen(PORT, () => {
  console.log(`CORS proxy running on http://localhost:${PORT} -> ${TARGET}`);
});
