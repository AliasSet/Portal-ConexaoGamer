export default async function handler(req, res) {
  const { code } = req.query;
  const client_id = process.env.OAUTH_CLIENT_ID;
  const client_secret = process.env.OAUTH_CLIENT_SECRET;

  // 1. Redireciona para o GitHub se não houver código
  if (!code) {
    return res.redirect(
      `https://github.com/login/oauth/authorize?client_id=${client_id}&scope=repo`
    );
  }

  // 2. Troca o código pelo Token de Acesso
  try {
    const response = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ client_id, client_secret, code }),
    });

    const data = await response.json();

    if (data.error || !data.access_token) {
      return res.status(400).send(`Erro na autenticação: ${data.error_description || data.error}`);
    }

    const token = data.access_token;

    // 3. Envia o token para a janela principal do Decap CMS e fecha a popup
    const html = `
      <!DOCTYPE html>
      <html>
      <head><title>Autenticado</title></head>
      <body>
        <p>Autenticação concluída com sucesso! A fechar janela...</p>
        <script>
          (function() {
            function receiveMessage(e) {
              console.log("A enviar token para:", e.origin);
              window.opener.postMessage(
                'authorization:github:success:${JSON.stringify({ token, provider: "github" })}',
                e.origin
              );
            }
            window.addEventListener("message", receiveMessage, false);
            window.opener.postMessage("authorizing:github", "*");
          })();
        </script>
      </body>
      </html>
    `;

    res.setHeader("Content-Type", "text/html");
    return res.status(200).send(html);
  } catch (err) {
    return res.status(500).send("Erro interno no servidor: " + err.message);
  }
}
