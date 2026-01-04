function delay(time, value, shouldReject = false) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      shouldReject ? reject(`Nope: ${value}`) : resolve(value);
    }, time);
  });
}

const quickFail = delay(500, "Too fast, too furious", true);
const midFail = delay(1000, "Still nope", true);
const slowWin = delay(1500, "I actually worked!");

Promise.any([quickFail, midFail, slowWin])
  .then((result) => {
    console.log("First success:", result);
  })
  .catch((err) => {
    console.error("Everything failed:", err);
  });
