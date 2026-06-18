let dataStream = [];
let maxPoints;

// This is our "Latch" variable. It holds the state until a NEW, valid state arrives.
let currentState = 0; 

function setup() {
  createCanvas(600, 200);
  maxPoints = width; 
  for (let i = 0; i < maxPoints; i++) {
    dataStream.push(0);
  }
}

function draw() {
  background(30, 30, 35); 
  
  // 1. CHECK FOR NEW SERIAL DATA
  // We call our function. If it returns a new valid number, we update the latch.
  // If it returns null (empty buffer), currentState stays exactly what it was.
  let incomingData = readSerial(); 
  
  if (incomingData === 1 || incomingData === 0) {
    currentState = incomingData; 
  }
  
  // 2. ADVANCE TIME
  // Time always moves forward on an oscilloscope. 
  // We push the latched currentState into the array every single frame.
  dataStream.push(currentState);
  if (dataStream.length > maxPoints) {
    dataStream.shift();
  }
  
  // 3. DRAW THE GRAPH
  stroke(0, 255, 150); 
  strokeWeight(2);
  noFill();
  
  beginShape();
  for (let i = 0; i < dataStream.length; i++) {
    let x = i;
    let y = dataStream[i] === 1 ? 50 : 150;
    
    // Draw the vertical "switch" line if the state changed between pixels
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

// --- MOCK SERIAL FUNCTION ---
// Replace the logic inside this function with your actual serial.read() code
function readSerial() {
  // SIMULATION: Every 90 frames, randomly decide to output a 1 or a 0.
  // The rest of the time, output nothing (null), simulating an empty serial buffer.
  if (frameCount % 90 === 0) {
    let mockData = random() > 0.5 ? 1 : 0;
    console.log("Serial sent new state:", mockData);
    return mockData;
  }
  
  // If no new data has arrived, return null. 
  // This prevents the graph from instantly dropping to 0!
  return null; 
}