let dataStream = [];
let maxPoints;

// Your serial code will update this single variable, just like the "little light"
let currentVal = 0; 

function setup() {
  createCanvas(600, 200);
  maxPoints = width; 
  
  // Fill the initial array with zeros
  for (let i = 0; i < maxPoints; i++) {
    dataStream.push(0);
  }
}

function draw() {
  // ---------------------------------------------------------
  // 1. YOUR SERIAL LOGIC GOES HERE
  // CRITICAL: You must use a loop to clear the backlog!
  // If you are using p5.serialport, it looks something like this:
  //
  // while (serial.available() > 0) {
  //   let inByte = serial.read(); // Read until the buffer is empty
  //   if (inByte === 0 || inByte === 1) {
  //     currentVal = inByte; // Only keep the absolute newest valid value
  //   }
  // }
  // ---------------------------------------------------------

  // 2. ADVANCE TIME & RECORD THE LATEST STATE
  // We record whatever currentVal is right now.
  dataStream.push(currentVal);
  if (dataStream.length > maxPoints) {
    dataStream.shift();
  }
  
  // 3. DRAW THE GRAPH
  background(30, 30, 35); 
  stroke(0, 255, 150); 
  strokeWeight(2);
  noFill();
  
  beginShape();
  for (let i = 0; i < dataStream.length; i++) {
    let x = i;
    // Map 1 to high (50) and 0 to low (150)
    let y = dataStream[i] === 1 ? 50 : 150;
    
    // Draw vertical lines for the sharp square-wave look
    if (i > 0 && dataStream[i] !== dataStream[i - 1]) {
      let prevY = dataStream[i - 1] === 1 ? 50 : 150;
      vertex(x, prevY); 
    }
    
    vertex(x, y);
  }
  endShape();
  
  // 4. DRAW LABELS
  noStroke();
  fill(255);
  textSize(14);
  text("1 (HIGH)", 10, 40);
  text("0 (LOW)", 10, 170);
  
  stroke(255, 255, 255, 50);
  strokeWeight(1);
  line(0, 100, width, 100);
}
