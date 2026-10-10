export default async function handler(req, res) {
  const { code } = req.query;
  const client_id = process.env.OAUTH_CLIENT_ID;
  const client_secret = process.env.OAUTH_CLIENT_SECRET;

  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ client_id, client_secret, code }),
  });

  const data = await response.json();
  const token = data.access_token;

  const content = token
    ? `authorization:github:success:${JSON.stringify({ token, provider: "github" })}`
    : `authorization:github:error:${JSON.stringify(data)}`;

  const script = `
    <script>
      function recieveMessage(e) {
        window.opener.postMessage("${content}", e.origin);
      }
      window.addEventListener("message", recieveMessage, false);
      window.opener.postMessage("authorizing:github", "*");
    </script>
  `;

  return res.send(script);
}
