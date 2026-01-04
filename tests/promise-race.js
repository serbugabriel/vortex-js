function delay(time, value, shouldReject = false) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (shouldReject) {
        reject(`💥 Oops! ${value} failed!`);
      } else {
        resolve(value);
      }
    }, time);
  });
}

const fastFail = delay(1000, "Fast fail", true); // rejects in 1 second
const slowWin = delay(3000, "Slow and steady"); // resolves in 3 seconds

Promise.race([fastFail, slowWin])
  .then((result) => {
    console.log("Winner:", result);
  })
  .catch((error) => {
    console.error("Race crashed:", error);
  });
