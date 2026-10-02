const loginForm = document.getElementById("loginForm");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const message = document.getElementById("message");
const loginBtn = document.getElementById("loginBtn");

function showMessage(text, type = "") {
  message.textContent = text;
  message.className = `message ${type}`;
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginBtn.disabled = true;
  showMessage("Signing in…");

  try {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: usernameInput.value.trim(),
        password: passwordInput.value
      })
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Login failed.");

    showMessage("Access granted. Opening dashboard…", "success");
    location.replace("/");
  } catch (error) {
    showMessage(error.message || "Something went wrong.", "error");
  } finally {
    loginBtn.disabled = false;
  }
});

usernameInput.focus();
