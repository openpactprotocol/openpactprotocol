const color = document.body.dataset.brandColor;
if (color) document.documentElement.style.setProperty("--brand", color);

const boxes = [...document.querySelectorAll('input[name="scope"]')];
const allow = document.getElementById("allow");
if (allow) {
  function update() {
    const n = boxes.filter((box) => box.checked).length;
    allow.textContent = "Allow " + n + " of " + boxes.length;
    allow.disabled = n === 0;
  }

  boxes.forEach((box) => box.addEventListener("change", update));
}
