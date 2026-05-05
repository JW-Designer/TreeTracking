let video;
let bodyPose; 
let poses = [];

// --- LAYOUT & UI VARIABLES ---
let TOPBAR_H = 300; // 👇 Increased height to fit 2 rows of data
let ACTIVE_W; 
let ACTIVE_H; 
let fontRegular; 
let vidDrawX = 0, vidDrawY = 0, vidDrawW = 0, vidDrawH = 0; // For camera aspect ratio

// --- DATA VARIABLES ---
let table;
let treeDataList = []; 
let completedTrees = []; 

// --- SYSTEM VARIABLES ---
let paletteAlive = ["#e3b43c", "#cbb691", "#8a7558"];
let paletteDead = ["#111111", "#120202", "#2c2c2c"];
let userImg;
let treeClusters = []; 
let trackedPeople = []; 
let lastClearTime = 0;
let CLEAR_INTERVAL = 120000; // 120 seconds
let globalTreeID = 1; 

function preload() {
  table = loadTable('Tree data - trees_atlanta_final (1).csv', 'csv', 'header');
  userImg = loadImage('newseed.png'); 
}

function setup() {
  createCanvas(3072, 1280);
  
  ACTIVE_W = width;
  ACTIVE_H = height - TOPBAR_H; 

  video = createCapture(VIDEO);
  video.hide(); // Don't force a size here, let it load at its natural aspect ratio

  bodyPose = ml5.bodyPose(video, () => {
    console.log("bodyPose (MoveNet) Ready");
    bodyPose.detectStart(video, (results) => {
      poses = results;
    });
  });

  parseCSV();
}

function parseCSV() {
  let dates = table.getColumn('PlantedDate').map(Number);
  let minDate = min(dates);
  let maxDate = max(dates);

  for (let i = 0; i < table.getRowCount(); i++) {
    let row = table.getRow(i);
    let rawDate = row.getNum('PlantedDate');
    
    let yearPlanted = "Unknown";
    if (!isNaN(rawDate)) {
      yearPlanted = new Date(rawDate).getFullYear();
    }

    let treeLat = row.getNum('Latitude');
    let treeLon = row.getNum('Longitude');
    let distanceMeters = calculateDistance(VIEWER_LAT, VIEWER_LON, treeLat, treeLon);

    treeDataList.push({
      species: row.get('Species') || "Unknown",
      status: row.get('Status') || "Unknown",
      year: yearPlanted,
      life: map(rawDate, minDate, maxDate, 400, 150),
      thickness: map(rawDate, minDate, maxDate, 30, 10),
      city: row.get('City') || "Unknown",
      county: row.get('County') || "Unknown",
      distance: floor(distanceMeters) 
    });
  }
}

function draw() {
  // 1. DYNAMIC CAMERA CROPPING ("Object-Fit: Cover" Math)
  if (video.width > 0 && video.height > 0) {
    let videoAspect = video.width / video.height;
    let canvasAspect = ACTIVE_W / ACTIVE_H;

    if (canvasAspect > videoAspect) {
      vidDrawW = ACTIVE_W;
      vidDrawH = ACTIVE_W / videoAspect;
      vidDrawX = 0;
      vidDrawY = (ACTIVE_H - vidDrawH) / 2; // Crop top/bottom
    } else {
      vidDrawH = ACTIVE_H;
      vidDrawW = ACTIVE_H * videoAspect;
      vidDrawX = (ACTIVE_W - vidDrawW) / 2; // Crop left/right
      vidDrawY = 0;
    }
  }

  // 2. Draw Live Video Background
  push();
  translate(0, TOPBAR_H); 
  translate(ACTIVE_W, 0); 
  scale(-1, 1); 
  
  if (vidDrawW > 0) {
    image(video, vidDrawX, vidDrawY, vidDrawW, vidDrawH); 
  }
  
  fill(0, 0, 0, 60); 
  rect(0, 0, ACTIVE_W, ACTIVE_H);
  pop();

  // 3. AUTO REFRESH SYSTEM 
  if (millis() - lastClearTime > CLEAR_INTERVAL) {
    treeClusters = []; 
    completedTrees = [];
    trackedPeople = [];
    globalTreeID = 1; 
    lastClearTime = millis();
    console.log("Canvas Auto-Cleared!");
  }

  // 4. TRACKING & STATIONARY LOGIC
  updateTrackedPeople();

  // 5. DRAW TREE CLUSTERS
  for (let i = treeClusters.length - 1; i >= 0; i--) {
    let cluster = treeClusters[i];
    cluster.update();
    cluster.draw();
    
    if (!cluster.logged) {
      completedTrees.unshift(cluster.data); 
      cluster.logged = true;
      
      // 👇 CHANGED: Increased to 10 trees to fill two rows!
      if (completedTrees.length > 10) completedTrees.pop(); 
    }
  }

  // 6. DRAW TOP UI
  drawTopBar(); 

  // 7. DRAW REGISTRATION MARKS
  drawRegistrationMarks();
}

function updateTrackedPeople() {
  let currentTime = millis();
  let currentPoses = [];
  
  let vW = video.width || 640;
  let vH = video.height || 480;

  for (let pose of poses) {
    let validPoints = 0;
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    for (let kp of pose.keypoints) {
      if (kp.confidence > 0.1) {
        // 👇 CHANGED: Map AI coordinates to match the cropped camera view
        let mappedX = map(kp.x, 0, vW, vidDrawX, vidDrawX + vidDrawW);
        let mappedY = map(kp.y, 0, vH, vidDrawY, vidDrawY + vidDrawH);

        minX = min(minX, mappedX);
        maxX = max(maxX, mappedX);
        minY = min(minY, mappedY);
        maxY = max(maxY, mappedY);
        validPoints++;
      }
    }

    if (validPoints > 5) {
      let centerX = ACTIVE_W - ((minX + maxX) / 2); 
      let centerY = ((minY + maxY) / 2) + TOPBAR_H; 
      currentPoses.push(createVector(centerX, centerY));
    }
  }

  for (let p of currentPoses) {
    let matched = false;
    for (let person of trackedPeople) {
      let d = dist(p.x, p.y, person.x, person.y);
      
      if (d < 250) { 
        matched = true;
        if (d < 100) {
          if (person.stopTime === 0) person.stopTime = currentTime;
          
          if (!person.hasPlanted && currentTime - person.stopTime > 1000) {
            plantSeed(person.x, person.y);
            person.hasPlanted = true;
          }
        } else {
          person.stopTime = 0;
          person.hasPlanted = false; 
        }

        person.x = lerp(person.x, p.x, 0.5);
        person.y = lerp(person.y, p.y, 0.5);
        person.lastSeen = currentTime;
        break;
      }
    }

    if (!matched) {
      trackedPeople.push({ x: p.x, y: p.y, stopTime: 0, lastSeen: currentTime, hasPlanted: false });
    }
  }

  for (let i = trackedPeople.length - 1; i >= 0; i--) {
    if (currentTime - trackedPeople[i].lastSeen > 2000) {
      trackedPeople.splice(i, 1);
    }
  }
}

function plantSeed(personX, personY) {
  let randomData = random(treeDataList);
  let uniqueTreeData = Object.assign({}, randomData);
  
  let seedX = personX; 
  let seedY = personY;

  treeClusters.push(new TreeCluster(seedX, seedY, uniqueTreeData));
}

function drawTopBar() {
  push();
  fill(255); 
  noStroke();
  rect(0, 0, width, TOPBAR_H); 
  
  stroke("#0b2f33");
  strokeWeight(4);
  line(0, TOPBAR_H, width, TOPBAR_H);

  // Title Section (Shifted down slightly to center it in the taller bar)
  fill("#0b2f33");
  noStroke();
  textSize(32);
  textStyle(BOLD);
  textAlign(LEFT, TOP);
  text("NEW ATLANTA FOREST", 40, 110);
  
  stroke("#e3b43c");
  strokeWeight(2);
  line(40, 155, 410, 155); 
  
  stroke(200); 
  line(450, 30, 450, TOPBAR_H - 30);

  // 👇 CHANGED: Grid System for Data Logs (2 Rows, 5 Columns)
  noStroke();
  let startX = 490; 
  let spacingX = 500; 
  let startY = 30; // Start height for the first row
  let spacingY = 140; // Drop down 140px for the second row

  for (let i = 0; i < completedTrees.length; i++) {
    let t = completedTrees[i];
    
    // Math to wrap the columns into two rows
    let col = i % 5; 
    let row = floor(i / 5); 
    
    let currentX = startX + (col * spacingX);
    let currentY = startY + (row * spacingY);
    
    // Draw ID Number Badge
    let dotColor = (t.status === "Alive") ? color(paletteAlive[0]) : color(paletteDead[0]);
    fill(dotColor);
    circle(currentX + 20, currentY + 20, 35); 

    fill(255); 
    textAlign(CENTER, CENTER);
    textSize(18);
    textStyle(BOLD);
    text(t.id, currentX + 20, currentY + 22); 

    // Text details vertically stacked next to the badge
    textAlign(LEFT, BASELINE);
    fill(40);
    textStyle(BOLD);
    textSize(20);
    text(`Species: ${t.species}`, currentX + 50, currentY + 15);
    
    textStyle(NORMAL);
    textSize(15);
    fill(100);
    text(`Status: ${t.status}  |  Planted: ${t.year}`, currentX + 50, currentY + 40);
    text(`City: ${t.city}  |  County: ${t.county}`, currentX + 50, currentY + 60);
    
    fill("#8a7558"); 
    textSize(16);
    text(`Distance: ${t.distance}m away`, currentX + 50, currentY + 85);
  }
  pop();
}

const VIEWER_LAT = 33.774306;
const VIEWER_LON = -84.395417;

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; 
  const p1 = lat1 * Math.PI / 180;
  const p2 = lat2 * Math.PI / 180;
  const dp = (lat2 - lat1) * Math.PI / 180;
  const dl = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; 
}

class TreeCluster {
  constructor(x, y, data) {
    this.x = x;
    this.y = y;
    this.data = data;
    this.branches = [];
    this.isFullyGrown = false;
    this.logged = false;

    this.id = globalTreeID++; 
    this.data.id = this.id; 

    let basePalette = (this.data.status === "Alive") ? paletteAlive : paletteDead;

    let numTrunks = floor(random(8, 15));
    for (let i = 0; i < numTrunks; i++) {
      let angle = random(TWO_PI);
      let col = color(random(basePalette));
      
      this.branches.push(new Branch(
        createVector(this.x, this.y), angle, this.data.thickness, 0, this.data.life, col, basePalette 
      ));
    }
  }

  update() {
    if (this.isFullyGrown) return;

    let allDead = true;
    for (let i = this.branches.length - 1; i >= 0; i--) {
      let b = this.branches[i];
      if (!b.dead) {
        b.step(this.branches); 
        allDead = false;
      }
    }
    
    if (allDead) {
      this.isFullyGrown = true;
    }
  }

  draw() {
    push();
    
    noStroke();
    fill(235, 233, 226, 230); 
    let bgSize = this.data.life * 2; 
    circle(this.x, this.y, bgSize);

    for (let b of this.branches) {
      b.draw();
    }

    imageMode(CENTER);
    if (userImg) {
      image(userImg, this.x, this.y, 60, 60);
    } else {
      fill("#e3b43c");
      circle(this.x, this.y, 60);
    }

    noStroke(); 
    fill(0); 
    circle(this.x, this.y - 50, 40); 
    
    fill(255); 
    textAlign(CENTER, CENTER);
    textSize(20);
    textStyle(BOLD);
    text(this.id, this.x, this.y - 48); 
    
    pop();
  }
}

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