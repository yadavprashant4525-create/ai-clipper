const videoInput = document.getElementById("video");
const urlInput = document.getElementById("videoUrl");
const transcriptInput = document.getElementById("transcript");
const analyzeButton = document.getElementById("analyze");
const makeButton = document.getElementById("makeClips");
const resultsPanel = document.getElementById("resultsPanel");
const clipList = document.getElementById("clipList");
const message = document.getElementById("message");

let selectedClips = [];

function toSeconds(value) {
  const parts = value.trim().split(":").map(Number);
  if (!parts.length || parts.some(n => !Number.isFinite(n) || n < 0)) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map(n => String(n).padStart(2, "0")).join(":");
}

function scoreLine(text) {
  const value = text.toLowerCase();
  const hooks = [
    " लेकिन ", "लेकिन", "secret", "raaz", "रहस्य", "खुलासा", "सच",
    "shocking", "चौंक", "यकीन", "believe", "अविश्वास", "धोखा",
    "गलती", "मजेदार", "हंसी", "हंस", "फनी", "funny", "amazing",
    "कमाल", "जबरदस्त", "पहली बार", "आखिर", "क्यों", "कैसे",
    "twist", "viral", "भाई", "अरे", "वाह", "देखो", "सोच"
  ];
  let score = 1;
  for (const word of hooks) if (value.includes(word)) score += 2;
  if (/[!?।]/.test(text)) score += 1;
  if (text.length > 45 && text.length < 220) score += 1;
  if (/\b(i|we|you|they)\b/i.test(text)) score += 0.5;
  return score;
}

function parseTranscript(raw) {
  const lines = raw.split(/\n+/).map(line => line.trim()).filter(Boolean);
  const parsed = [];
  for (const line of lines) {
    const match = line.match(/^(\d{1,2}:\d{2}(?::\d{2})?)\s+(.+)$/);
    if (!match) continue;
    const time = toSeconds(match[1]);
    if (time !== null && match[2].trim()) {
      parsed.push({ time, text: match[2].trim(), score: scoreLine(match[2]) });
    }
  }
  return parsed.sort((a, b) => a.time - b.time);
}

analyzeButton.addEventListener("click", () => {
  const parsed = parseTranscript(transcriptInput.value);
  if (parsed.length < 10) {
    message.textContent = "Kam se kam 10 timestamp wali transcript lines chahiye. Format: 00:01:12 Dialogue";
    resultsPanel.hidden = true;
    return;
  }

  const ranked = [...parsed].sort((a, b) => b.score - a.score);
  selectedClips = [];
  for (const item of ranked) {
    if (selectedClips.every(chosen => Math.abs(chosen.time - item.time) >= 45)) {
      selectedClips.push(item);
    }
    if (selectedClips.length === 10) break;
  }

  if (selectedClips.length < 10) {
    message.textContent = "10 alag moments nahi mile. Zyada timestamp lines add karein aur dobara try karein.";
    resultsPanel.hidden = true;
    return;
  }

  selectedClips.sort((a, b) => a.time - b.time);
  clipList.replaceChildren();
  selectedClips.forEach((clip, index) => {
    const li = document.createElement("li");
    const strong = document.createElement("strong");
    strong.textContent = "Clip " + (index + 1) + " · " + formatTime(clip.time);
    const p = document.createElement("p");
    p.textContent = clip.text;
    li.append(strong, p);
    clipList.append(li);
  });
  resultsPanel.hidden = false;
  message.textContent = "10 moments select ho gaye. Original video file upload karke Create all 10 clips dabayein.";
});

async function createOneClip(file, start, end, index) {
  const form = new FormData();
  form.append("video", file);
  form.append("start", String(start));
  form.append("end", String(end));
  const response = await fetch("/api/clip", { method: "POST", body: form });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || "Clip " + index + " create nahi hui.");
  }
  const blob = await response.blob();
  if (!blob.size) throw new Error("Clip " + index + " empty hai.");
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = "ai-clip-" + String(index).padStart(2, "0") + ".mp4";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
}

makeButton.addEventListener("click", async () => {
  const file = videoInput.files[0];
  if (!file) {
    message.textContent = "Pehle creator ki permission wala original video upload karein.";
    return;
  }
  if (selectedClips.length !== 10) {
    message.textContent = "Pehle Find 10 best moments dabayein.";
    return;
  }

  makeButton.disabled = true;
  analyzeButton.disabled = true;
  try {
    for (let i = 0; i < selectedClips.length; i++) {
      const start = Math.max(0, selectedClips[i].time - 10);
      const end = start + 45;
      message.textContent = "Creating clip " + (i + 1) + " of 10...";
      await createOneClip(file, start, end, i + 1);
    }
    message.textContent = "10 clips ready! Downloads aapke phone/browser mein save ho rahe hain.";
  } catch (error) {
    message.textContent = error.message;
  } finally {
    makeButton.disabled = false;
    analyzeButton.disabled = false;
  }
});
