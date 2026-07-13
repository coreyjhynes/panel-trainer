/* Azure Function (v3 model): GET/POST/DELETE /api/scores — anonymous. */
const { handleRequest } = require("../lib/handler");

module.exports = async function (context, req) {
  try {
    const result = await handleRequest({
      method: req.method,
      query: req.query || {},
      body: req.body,
    });
    context.res = {
      status: result.status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
      body: JSON.stringify(result.body),
    };
  } catch (e) {
    context.res = {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: String((e && e.message) || e) }),
    };
  }
};
