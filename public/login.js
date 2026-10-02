const loginForm = document.getElementById("loginForm");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const message = document.getElementById("message");
const loginBtn = document.getElementById("loginBtn");

function showMessage(text, type = "") {
  message.textContent = text;
  message.className = `message ${type}`;
}

function getDeviceId() {
  const key = "skyline_device_id";
  let deviceId = localStorage.getItem(key);

  if (!deviceId) {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    deviceId = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    localStorage.setItem(key, deviceId);
  }

  return deviceId;
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginBtn.disabled = true;
  showMessage("Signing in…");

  try {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Skyline-Device": getDeviceId()
      },
      body: JSON.stringify({
        username: usernameInput.value.trim(),
        password: passwordInput.value
      })
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Login failed.");

    showMessage("Access granted. Initializing dashboard…", "success");
    document.body.classList.add("login-exit");
    document.getElementById("loginLoader").classList.add("is-visible");
    await new Promise((resolve) => setTimeout(resolve, 1250));
    location.replace("/");
  } catch (error) {
    showMessage(error.message || "Something went wrong.", "error");
  } finally {
    loginBtn.disabled = false;
  }
});

usernameInput.focus();
