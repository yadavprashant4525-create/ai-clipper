
const videoInput = document.getElementById("video");
const startInput = document.getElementById("start");
const endInput = document.getElementById("end");
const createButton = document.getElementById("create");
const message = document.getElementById("message");

createButton.addEventListener("click", async () => {
  const video = videoInput.files[0];
  const start = Number(startInput.value);
  const end = Number(endInput.value);

  if (!video) {
    message.textContent = "Please choose a video first.";
    return;
  }

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end <= start ||
    end - start > 600
  ) {
    message.textContent = "Please enter valid clip timings.";
    return;
  }

  const formData = new FormData();
  formData.append("video", video);
  formData.append("start", start);
  formData.append("end", end);

  createButton.disabled = true;
  message.textContent = "Creating your clip... Please wait.";

  try {
    const response = await fetch("/api/clip", {
      method: "POST",
      body: formData
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Clip creation failed.");
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = "my-clip.mp4";
    document.body.appendChild(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(url);
    message.textContent = "Your clip is ready!";
  } catch (error) {
    message.textContent = error.message;
  } finally {
    createButton.disabled = false;
  }
});
