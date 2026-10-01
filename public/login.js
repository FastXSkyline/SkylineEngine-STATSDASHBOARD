const emailForm = document.getElementById("emailForm");
const codeForm = document.getElementById("codeForm");
const emailInput = document.getElementById("email");
const codeInput = document.getElementById("code");
const message = document.getElementById("message");
const sendBtn = document.getElementById("sendBtn");
const verifyBtn = document.getElementById("verifyBtn");
const backBtn = document.getElementById("backBtn");

function showMessage(text, type = "") {
  message.textContent = text;
  message.className = `message ${type}`;
}

emailForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  sendBtn.disabled = true;
  showMessage("Sending verification code…");
  try {
    const response = await fetch("/api/auth/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: emailInput.value.trim() })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not send code.");
    emailForm.hidden = true;
    codeForm.hidden = false;
    codeInput.focus();
    showMessage("Code sent. Check your email.", "success");
  } catch (error) {
    showMessage(error.message || "Something went wrong.", "error");
  } finally {
    sendBtn.disabled = false;
  }
});

codeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  verifyBtn.disabled = true;
  showMessage("Verifying code…");
  try {
    const response = await fetch("/api/auth/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: emailInput.value.trim(), code: codeInput.value.trim() })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Verification failed.");
    showMessage("Access granted. Opening dashboard…", "success");
    location.replace("/");
  } catch (error) {
    showMessage(error.message || "Something went wrong.", "error");
  } finally {
    verifyBtn.disabled = false;
  }
});

backBtn.addEventListener("click", () => {
  codeForm.hidden = true;
  emailForm.hidden = false;
  codeInput.value = "";
  showMessage("");
  emailInput.focus();
});
