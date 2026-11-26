const videoInput = document.getElementById("video");
const analyzeButton = document.getElementById("analyze");
const makeButton = document.getElementById("makeClips");
const resultsPanel = document.getElementById("resultsPanel");
const clipList = document.getElementById("clipList");
const message = document.getElementById("message");
let selectedClips = [];

function timeLabel(seconds) {
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map(n => String(n).padStart(2, "0")).join(":");
}

analyzeButton.addEventListener("click", async () => {
  const file = videoInput.files[0];
  if (!file) {
    message.textContent = "Pehle creator ki permission wala original video file choose karein.";
    return;
  }
  analyzeButton.disabled = true;
  makeButton.disabled = true;
  resultsPanel.hidden = true;
  message.textContent = "Video upload ho raha hai aur AI speech transcribe kar raha hai. Video lamba hua to kuch minute lag sakte hain...";
  try {
    const form = new FormData();
    form.append("video", file);
    const response = await fetch("/api/analyze-video", { method: "POST", body: form });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "AI analysis nahi ho paya.");
    selectedClips = body.clips;
    clipList.replaceChildren();
    selectedClips.forEach((clip, index) => {
      const li = document.createElement("li");
      const strong = document.createElement("strong");
      strong.textContent = "Clip " + (index + 1) + " · " + timeLabel(clip.start) + " – " + timeLabel(clip.end) + " (" + Math.round(clip.end - clip.start) + " sec)";
      const title = document.createElement("p");
      title.textContent = clip.title;
      const reason = document.createElement("p");
      reason.className = "hint";
      reason.textContent = clip.reason;
      li.append(strong, title, reason);
      clipList.append(li);
    });
    resultsPanel.hidden = false;
    message.textContent = "AI ne 10 moments chun liye. Ab Create & download par tap karein.";
  } catch (error) {
    message.textContent = error.message;
  } finally {
    analyzeButton.disabled = false;
    makeButton.disabled = false;
  }
});

makeButton.addEventListener("click", async () => {
  const file = videoInput.files[0];
  if (!file || selectedClips.length !== 10) {
    message.textContent = "Pehle video upload karke AI analysis chalayein.";
    return;
  }
  makeButton.disabled = true;
  analyzeButton.disabled = true;
  message.textContent = "10 clips ban rahi hain. Server par kuch minute lag sakte hain...";
  try {
    const form = new FormData();
    form.append("video", file);
    form.append("clips", JSON.stringify(selectedClips));
    const response = await fetch("/api/create-clips", { method: "POST", body: form });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || "Clips create nahi ho paayi.");
    }
    const blob = await response.blob();
    if (!blob.size) throw new Error("ZIP file empty hai.");
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "ai-clips-10.zip";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    message.textContent = "10 clips ki ZIP download shuru ho gayi. Phone ke Downloads folder me dekhein.";
  } catch (error) {
    message.textContent = error.message;
  } finally {
    makeButton.disabled = false;
    analyzeButton.disabled = false;
  }
});
