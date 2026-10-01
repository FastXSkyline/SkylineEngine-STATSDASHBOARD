export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders()
      });
    }

    if (url.pathname === "/launch" && request.method === "POST") {
      try {
        const body = await request.json();
        const userId = body.user_id;
        const appVersion = body.app_version || "unknown";

        if (!userId || typeof userId !== "string") {
          return json({ error: "user_id is required" }, 400);
        }

        await env.DB.prepare(
          "INSERT INTO launches (user_id, app_version) VALUES (?, ?)"
        ).bind(userId, appVersion).run();

        return json({ success: true });
      } catch (error) {
        return json({ error: "Failed to record launch" }, 500);
      }
    }

    if (url.pathname === "/api/stats" && request.method === "GET") {
      try {
        const result = await env.DB.prepare(
          "SELECT COUNT(*) AS launches, COUNT(DISTINCT user_id) AS users FROM launches"
        ).first();

        return json({
          launches: result?.launches ?? 0,
          users: result?.users ?? 0
        });
      } catch (error) {
        return json({ error: "Failed to fetch stats" }, 500);
      }
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not found", {
      status: 404,
      headers: corsHeaders()
    });
  }
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders()
    }
  });
}
