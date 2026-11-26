const videoInput = document.getElementById("video");
const urlInput = document.getElementById("videoUrl");
const startInput = document.getElementById("start");
const endInput = document.getElementById("end");

const createButton = document.getElementById("create");
const createUrlButton = document.getElementById("createFromUrl");
const message = document.getElementById("message");

function getTiming() {
  const start = Number(startInput.value);
  const end = Number(endInput.value);

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end <= start ||
    end - start > 600
  ) {
    throw new Error("Please enter valid clip timings (maximum 600 seconds).");
  }

  return { start, end };
}

function setBusy(busy) {
  createButton.disabled = busy;
  createUrlButton.disabled = busy;
}

async function downloadClip(response) {
  if (!response.ok) {
    const text = await response.text();
    let errorMessage = `Server error (${response.status})`;

    try {
      const data = JSON.parse(text);
      errorMessage = data.error || errorMessage;
    } catch {
      if (text.trim()) errorMessage = text.slice(0, 300);
    }

    throw new Error(errorMessage);
  }

  const blob = await response.blob();

  if (!blob.size) {
    throw new Error("The server returned an empty video.");
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = "my-clip.mp4";
  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
  message.textContent = "Your clip is ready!";
}

// Gallery video
createButton.addEventListener("click", async () => {
  const video = videoInput.files[0];

  if (!video) {
    message.textContent = "Please choose a video first.";
    return;
  }

  try {
    const { start, end } = getTiming();

    const formData = new FormData();
    formData.append("video", video);
    formData.append("start", start);
    formData.append("end", end);

    setBusy(true);
    message.textContent = "Creating your clip... Please wait.";

    const response = await fetch("/api/clip", {
      method: "POST",
      body: formData
    });

    await downloadClip(response);
  } catch (error) {
    message.textContent = error.message || "Something went wrong.";
  } finally {
    setBusy(false);
  }
});

// Direct MP4 URL
createUrlButton.addEventListener("click", async () => {
  const videoUrl = urlInput.value.trim();

  if (!videoUrl) {
    message.textContent = "Please enter a direct MP4 video link.";
    return;
  }

  try {
    const { start, end } = getTiming();

    setBusy(true);
    message.textContent = "Downloading video and creating your clip... Please wait.";

    const response = await fetch("/api/clip-from-url", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        url: videoUrl,
        start,
        end
      })
    });

    await downloadClip(response);
  } catch (error) {
    message.textContent = error.message || "Something went wrong.";
  } finally {
    setBusy(false);
  }
});
