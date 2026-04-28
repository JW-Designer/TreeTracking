let video;
let bodyPose; 
let poses = [];

// --- LAYOUT & UI VARIABLES ---
let SIDEBAR_W = 600;
let ACTIVE_W; // Will be calculated in setup
let fontRegular; 

// --- DATA VARIABLES ---
let table;
let treeDataList = []; // Parsed CSV data
let completedTrees = []; // Data to display in the sidebar

// --- SYSTEM VARIABLES ---
let paletteAlive = ["#e3b43c", "#cbb691", "#8a7558"];
let paletteDead = ["#111111", "#120202", "#2c2c2c"];
let userImg;
let treeClusters = []; // Holds all active growing seeds
let trackedPeople = []; // Tracks people's stillness
let lastClearTime = 0;
let CLEAR_INTERVAL = 120000; // 120 seconds

function preload() {
  table = loadTable('Tree data - trees_atlanta_final (1).csv', 'csv', 'header');
  userImg = loadImage('newseed.png'); 
}

function setup() {
  // Lock the canvas to the exact physical resolution of your billboard
  createCanvas(3072, 1280);
  ACTIVE_W = width - SIDEBAR_W;

  video = createCapture(VIDEO);
  video.size(ACTIVE_W, height); // Camera maps exactly to the active drawing area
  video.hide();

  bodyPose = ml5.bodyPose(video, () => {
    console.log("bodyPose (MoveNet) Ready");
    bodyPose.detectStart(video, (results) => {
      poses = results;
    });
  });

  parseCSV();
}

// Extract CSV data into a usable array of objects
function parseCSV() {
  let dates = table.getColumn('PlantedDate').map(Number);
  let minDate = min(dates);
  let maxDate = max(dates);

  for (let i = 0; i < table.getRowCount(); i++) {
    let row = table.getRow(i);
    let rawDate = row.getNum('PlantedDate');
    
    // Convert timestamp
    let yearPlanted = "Unknown";
    if (!isNaN(rawDate)) {
      yearPlanted = new Date(rawDate).getFullYear();
    }

    // Grab Latitude and Longitude from the CSV
    let treeLat = row.getNum('Latitude');
    let treeLon = row.getNum('Longitude');
    
    // Calculate the distance from the viewer in meters
    let distanceMeters = calculateDistance(VIEWER_LAT, VIEWER_LON, treeLat, treeLon);

    treeDataList.push({
      species: row.get('Species') || "Unknown",
      status: row.get('Status') || "Unknown",
      year: yearPlanted,
      life: map(rawDate, minDate, maxDate, 400, 150),
      thickness: map(rawDate, minDate, maxDate, 30, 10),
      city: row.get('City') || "Unknown",
      county: row.get('County') || "Unknown",
      // Save the calculated distance
      distance: floor(distanceMeters) 
    });
  }
}

function draw() {
  // 1. Draw Live Video Background (Active Area)
  push();
  translate(SIDEBAR_W, 0); // Shift past the sidebar
  translate(ACTIVE_W, 0); // Move to the right edge for mirroring
  scale(-1, 1); // Flip horizontally for the mirror effect
  
  // Draw the camera feed filling the entire active area
  image(video, 0, 0, ACTIVE_W, height); 
  
  // Very slight dark tint over the video so the white circles and trees pop out more
  fill(0, 0, 0, 60); 
  rect(0, 0, ACTIVE_W, height);
  pop();

  // 2. AUTO REFRESH SYSTEM 
  if (millis() - lastClearTime > CLEAR_INTERVAL) {
    treeClusters = []; 
    completedTrees = [];
    trackedPeople = [];
    lastClearTime = millis();
    console.log("Canvas Auto-Cleared!");
  }

  // 3. TRACKING & STATIONARY LOGIC
  updateTrackedPeople();

  // 4. DRAW TREE CLUSTERS (Seeds + Backgrounds + Roots)
  for (let i = treeClusters.length - 1; i >= 0; i--) {
    let cluster = treeClusters[i];
    cluster.update();
    cluster.draw();
    
    // Log its data to the sidebar IMMEDIATELY
    if (!cluster.logged) {
      completedTrees.unshift(cluster.data); // Add to top of the list
      cluster.logged = true;
      
      // Keep the list from overflowing the screen
      if (completedTrees.length > 15) completedTrees.pop(); 
    }
  }

  // 5. DRAW SIDEBAR UI
  drawSidebar();

  // 6. DRAW REGISTRATION MARKS
  drawRegistrationMarks();
}

// --- Tracking People & Detecting Stillness ---
function updateTrackedPeople() {
  let currentTime = millis();

  // Map incoming poses to our active area
  let currentPoses = [];
  for (let pose of poses) {
    let validPoints = 0;
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    for (let kp of pose.keypoints) {
      if (kp.confidence > 0.1) {
        minX = min(minX, kp.x);
        maxX = max(maxX, kp.x);
        minY = min(minY, kp.y);
        maxY = max(maxY, kp.y);
        validPoints++;
      }
    }

    if (validPoints > 5) {
      // Mirror the X coordinate and shift it past the SIDEBAR_W
      let centerX = ACTIVE_W - ((minX + maxX) / 2) + SIDEBAR_W;
      let centerY = (minY + maxY) / 2;
      currentPoses.push(createVector(centerX, centerY));
    }
  }

  // Match current poses to our memory of tracked people
  for (let p of currentPoses) {
    let matched = false;
    for (let person of trackedPeople) {
      let d = dist(p.x, p.y, person.x, person.y);
      
      if (d < 250) { // Same person bounding area
        matched = true;
        
        // If they moved less than 100 pixels, they are standing still
        if (d < 100) {
          if (person.stopTime === 0) person.stopTime = currentTime;
          
          // Have they been still for 1 second?
          if (!person.hasPlanted && currentTime - person.stopTime > 1000) {
            plantSeed(person.x, person.y);
            person.hasPlanted = true;
          }
        } else {
          // They moved! Reset stationary timer
          person.stopTime = 0;
          person.hasPlanted = false; 
        }

        // Smooth update
        person.x = lerp(person.x, p.x, 0.5);
        person.y = lerp(person.y, p.y, 0.5);
        person.lastSeen = currentTime;
        break;
      }
    }

    // New person entered
    if (!matched) {
      trackedPeople.push({
        x: p.x, y: p.y,
        stopTime: 0,
        lastSeen: currentTime,
        hasPlanted: false
      });
    }
  }

  // Remove people who left the screen
  for (let i = trackedPeople.length - 1; i >= 0; i--) {
    if (currentTime - trackedPeople[i].lastSeen > 2000) {
      trackedPeople.splice(i, 1);
    }
  }
}

// --- Plant a Seed ---
function plantSeed(personX, personY) {
  // Grab a random tree from the dataset
  let randomData = random(treeDataList);
  
  // Plant 1 meter (~300 pixels) to the right. 
  // Ensure it doesn't go off the right edge of the screen.
  let seedX = min(personX + 300, width - 200); 
  let seedY = personY;

  treeClusters.push(new TreeCluster(seedX, seedY, randomData));
}

// --- UI Rendering ---
function drawSidebar() {
  push();
  fill(255); // White background
  noStroke();
  rect(0, 0, SIDEBAR_W, height);
  
  // Right border for the sidebar
  stroke("#0b2f33");
  strokeWeight(4);
  line(SIDEBAR_W, 0, SIDEBAR_W, height);

  // Title
  fill("#0b2f33");
  noStroke();
  textSize(32);
  textStyle(BOLD);
  textAlign(LEFT, TOP);
  text("NEW ATLANTA FOREST", 40, 50);
  
  stroke("#e3b43c");
  strokeWeight(2);
  line(40, 95, SIDEBAR_W - 40, 95);

  // Draw Data Logs
  noStroke();
  textSize(20);
  let startY = 130;
  let spacing = 110; 

  for (let i = 0; i < completedTrees.length; i++) {
    let t = completedTrees[i];
    
    // Status Indicator Dot
    let dotColor = (t.status === "Alive") ? color(paletteAlive[0]) : color(paletteDead[0]);
    fill(dotColor);
    circle(50, startY + (i * spacing) + 10, 15);

    // Text details
    fill(40);
    textStyle(BOLD);
    text(`Species: ${t.species}`, 75, startY + (i * spacing));
    textStyle(NORMAL);
    textSize(16);
    fill(100);
    text(`Status: ${t.status}  |  Planted: ${t.year}`, 75, startY + (i * spacing) + 25);
    text(`City: ${t.city}  |  County: ${t.county}`, 75, startY + (i * spacing) + 45);
    
    // Display the distance
    fill("#8a7558"); 
    textSize(20);
    text(`Your tree is ${t.distance} meters away from you.`, 75, startY + (i * spacing) + 65);
    
  }
  pop();
}

// Viewer's static location (Converted from 33°46'27.5"N 84°23'43.5"W)
const VIEWER_LAT = 33.774306;
const VIEWER_LON = -84.395417;

// The Haversine Formula to calculate distance in meters between two coordinates
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Earth's radius in meters
  const p1 = lat1 * Math.PI / 180;
  const p2 = lat2 * Math.PI / 180;
  const dp = (lat2 - lat1) * Math.PI / 180;
  const dl = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(dp / 2) * Math.sin(dp / 2) +
            Math.cos(p1) * Math.cos(p2) *
            Math.sin(dl / 2) * Math.sin(dl / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in meters
}

// --- Tree Cluster Class (One Seed = One Dataset Entry) ---
class TreeCluster {
  constructor(x, y, data) {
    this.x = x;
    this.y = y;
    this.data = data;
    this.branches = [];
    this.isFullyGrown = false;
    this.logged = false;

    // Pick base color based on dataset status
    let basePalette = (this.data.status === "Alive") ? paletteAlive : paletteDead;

    // Spawn radial trunks using THIS tree's data length
    let numTrunks = floor(random(8, 15));
    for (let i = 0; i < numTrunks; i++) {
      let angle = random(TWO_PI);
      let col = color(random(basePalette));
      
      this.branches.push(new Branch(
        createVector(this.x, this.y), 
        angle, 
        this.data.thickness, 
        0, 
        this.data.life, 
        col,
        basePalette 
      ));
    }
  }

  update() {
    if (this.isFullyGrown) return;

    let allDead = true;
    for (let i = this.branches.length - 1; i >= 0; i--) {
      let b = this.branches[i];
      if (!b.dead) {
        b.step(this.branches); // Pass array so it can spawn splinters
        allDead = false;
      }
    }
    
    if (allDead) {
      this.isFullyGrown = true;
    }
  }

  draw() {
    push();
    
    // 1. Draw Localized Background Circle
    noStroke();
    fill(235, 233, 226, 230); 
    let bgSize = this.data.life * 2; 
    circle(this.x, this.y, bgSize);

    // 2. Draw the Growing Roots
    for (let b of this.branches) {
      b.draw();
    }

    // 3. Draw the Seed Image in the center
    imageMode(CENTER);
    if (userImg) {
      image(userImg, this.x, this.y, 60, 60);
    } else {
      fill("#e3b43c");
      circle(this.x, this.y, 60);
    }
    pop();
  }
}

// --- Branch Class ---
class Branch {
  constructor(pos, angle, thickness, gen, life, col, palette) {
    this.pos = pos.copy();
    this.angle = angle;
    this.thickness = thickness;
    this.gen = gen;
    this.life = life;
    this.age = 0;
    this.col = col;
    this.palette = palette;
    this.dead = false;
    this.segmentLength = floor(random(10, 25));
    this.history = [];
  }

  step(branchArray) {
    this.age++;
    this.history.push({ pos: this.pos.copy(), thick: this.thickness });

    if (this.age % this.segmentLength === 0) {
      this.angle += random([-0.3, 0.3, -0.1, 0.1]);
      this.segmentLength = floor(random(10, 20));
    }

    let speed = 1.2;
    this.pos.add(p5.Vector.fromAngle(this.angle).mult(speed));
    this.thickness *= 0.997;

    if (this.age > this.life || this.thickness < 1.0) this.dead = true;

    // Splintering logic 
    if (random() < 0.008 && this.gen < 4 && branchArray.length < 500) {
      branchArray.push(new Branch(
        this.pos.copy(),
        this.angle + random([-0.5, 0.5]),
        this.thickness * 0.7,
        this.gen + 1,
        this.life * 0.7,
        this.col,
        this.palette
      ));
    }
  }

  draw() {
    noFill();
    stroke(this.col);
    
    // Draw using line segments so the thickness properly tapers
    for (let i = 1; i < this.history.length; i++) {
      strokeWeight(this.history[i].thick);
      line(
        this.history[i - 1].pos.x,
        this.history[i - 1].pos.y,
        this.history[i].pos.x,
        this.history[i].pos.y
      );
    }
  }
}

// --- REGISTRATION MARKS ---
function drawRegistrationMarks() {
  push();
  stroke(255, 0, 0); 
  strokeWeight(6);
  noFill();
  
  let m = 60; 
  line(0, 0, m, 0); line(0, 0, 0, m);
  line(width, 0, width - m, 0); line(width, 0, width, m);
  line(0, height, m, height); line(0, height, 0, height - m);
  line(width, height, width - m, height); line(width, height, width, height - m);

  strokeWeight(2);
  line(width / 2 - 20, height / 2, width / 2 + 20, height / 2);
  line(width / 2, height / 2 - 20, width / 2, height / 2 + 20);
  pop();
}