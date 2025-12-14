// === 基本参数 ===
const GRID_HALF = 15;           // 网格半径
const MOVE_INTERVAL_SEC = 0.18; // 逻辑一步时间（秒）
const FOOD_COUNT = 3;           // 同时存在的食物数量
const OBSTACLE_COUNT = 3;       // 障碍数量（改成 3 个大块）

// === three.js 基本设置 ===
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x202020);

const camera = new THREE.PerspectiveCamera(
    60, // 视角稍微窄一点，看起来更近
    window.innerWidth / window.innerHeight,
    0.1,
    1000
);
// 相机更靠近棋盘一些
camera.position.set(12, 16, 18);

const controls = new THREE.OrbitControls(camera, renderer.domElement);
// 默认看向棋盘中心
controls.target.set(0, 0.5, 0);
controls.update();

// 地面
const groundSize = GRID_HALF * 2 + 4;
const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(groundSize, groundSize),
    new THREE.MeshBasicMaterial({
        color: 0x333333,
        side: THREE.DoubleSide,
    })
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

// === DOM 元素 ===
const scoreEl = document.getElementById("score");
const statusEl = document.getElementById("status");
const gameOverPanel = document.getElementById("gameOverPanel");
const gameOverReasonEl = document.getElementById("gameOverReason");
const finalScoreEl = document.getElementById("finalScore");
const restartButton = document.getElementById("restartButton");

// === 游戏状态 ===
let snake = [{ x: 0, z: 0 }];
let direction = { x: 1, z: 0 };
let snakeMeshes = [];

let foods = [];      // {x,z,mesh}
let obstacles = [];  // {cells: [{x,z}...], mesh}  一个障碍占 2x2=4 个格子

let moveTimer = 0;
let moveProgress = 1;
let lastTime = 0;

let score = 0;
let gameOver = false;

// === 材质 ===
const snakeMaterial = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
const foodMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
const obstacleMaterial = new THREE.MeshBasicMaterial({ color: 0x5555ff });

// === UI 工具 ===
function updateScore() {
    scoreEl.textContent = `Score: ${score}`;
}

function setStatus(msg) {
    statusEl.textContent = msg || "";
}

function showGameOver(reason) {
    gameOverPanel.style.display = "block";
    gameOverReasonEl.textContent = reason || "";
    finalScoreEl.textContent = score.toString();
}

function hideGameOver() {
    gameOverPanel.style.display = "none";
}

// === mesh 工厂 ===
function createSnakeSegmentMesh() {
    const cube = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        snakeMaterial
    );
    cube.userData.prevPos = new THREE.Vector3();
    cube.userData.targetPos = new THREE.Vector3();
    return cube;
}

function createFoodMesh() {
    return new THREE.Mesh(
        new THREE.SphereGeometry(0.6, 16, 16),
        foodMaterial
    );
}

function createObstacleMesh() {
    // 2x2 的大块障碍
    return new THREE.Mesh(
        new THREE.BoxGeometry(2, 1, 2),
        obstacleMaterial
    );
}

// === 障碍占格子判断 ===
function obstacleOccupiesCell(x, z) {
    return obstacles.some((o) =>
        o.cells.some((c) => c.x === x && c.z === z)
    );
}

// 随机找一个空格，不跟蛇/食物/障碍重叠
function randomEmptyCell() {
    while (true) {
        const x = Math.floor((Math.random() * 2 - 1) * GRID_HALF);
        const z = Math.floor((Math.random() * 2 - 1) * GRID_HALF);

        const conflictSnake = snake.some((s) => s.x === x && s.z === z);
        const conflictFood = foods.some((f) => f.x === x && f.z === z);
        const conflictObs = obstacleOccupiesCell(x, z);

        if (!conflictSnake && !conflictFood && !conflictObs) {
            return { x, z };
        }
    }
}

// 保证有 FOOD_COUNT 个食物
function ensureFoods() {
    while (foods.length < FOOD_COUNT) {
        const cell = randomEmptyCell();
        const mesh = createFoodMesh();
        mesh.position.set(cell.x, 0.6, cell.z);
        scene.add(mesh);
        foods.push({ x: cell.x, z: cell.z, mesh });
    }
}

// 随机生成一个 2x2 障碍的 base cell（左下角）
function randomObstacleBaseCell() {
    while (true) {
        // 2x2 要完全在边界里面，所以最大只能到 GRID_HALF-1
        const x = Math.floor(Math.random() * (GRID_HALF * 2)) - GRID_HALF;
        const z = Math.floor(Math.random() * (GRID_HALF * 2)) - GRID_HALF;

        if (x > GRID_HALF - 1 || z > GRID_HALF - 1) continue;

        const cells = [
            { x, z },
            { x: x + 1, z },
            { x, z: z + 1 },
            { x: x + 1, z: z + 1 },
        ];

        // 和蛇 / 食物 / 现有障碍都不能撞
        let conflict = false;
        for (const c of cells) {
            if (snake.some((s) => s.x === c.x && s.z === c.z)) { conflict = true; break; }
            if (foods.some((f) => f.x === c.x && f.z === c.z)) { conflict = true; break; }
            if (obstacleOccupiesCell(c.x, c.z)) { conflict = true; break; }
        }
        if (!conflict) return { x, z, cells };
    }
}

// 初始化障碍物（3 个 2x2）
function initObstacles() {
    obstacles.forEach((o) => scene.remove(o.mesh));
    obstacles = [];

    for (let i = 0; i < OBSTACLE_COUNT; i++) {
        const info = randomObstacleBaseCell();
        const mesh = createObstacleMesh();
        // mesh 中心在 2x2 方块中心，所以 +0.5
        mesh.position.set(info.x + 1, 0.5, info.z + 1);
        scene.add(mesh);

        obstacles.push({
            cells: info.cells,
            mesh,
        });
    }
}

// 更新蛇每一节的 prev/target，用于插值
function updateSnakeTargets() {
    for (let i = 0; i < snake.length; i++) {
        const seg = snake[i];
        let mesh = snakeMeshes[i];

        if (!mesh) {
            mesh = createSnakeSegmentMesh();
            scene.add(mesh);
            snakeMeshes[i] = mesh;
            mesh.position.set(seg.x, 0.5, seg.z);
            mesh.userData.prevPos.copy(mesh.position);
            mesh.userData.targetPos.copy(mesh.position);
        } else {
            mesh.userData.prevPos.copy(mesh.position);
            mesh.userData.targetPos.set(seg.x, 0.5, seg.z);
        }
    }

    for (let i = snake.length; i < snakeMeshes.length; i++) {
        scene.remove(snakeMeshes[i]);
    }
    snakeMeshes.length = snake.length;

    moveProgress = 0;
}

// 重置游戏
function resetGame() {
    gameOver = false;
    hideGameOver();
    setStatus("");

    snake = [{ x: 0, z: 0 }];
    direction = { x: 1, z: 0 };
    snakeMeshes.forEach((m) => scene.remove(m));
    snakeMeshes = [];

    foods.forEach((f) => scene.remove(f.mesh));
    foods = [];

    score = 0;
    updateScore();

    updateSnakeTargets();
    ensureFoods();
    initObstacles();
}

// Game Over
function triggerGameOver(reason) {
    if (gameOver) return;
    gameOver = true;
    setStatus("Game Over");

    snakeMeshes.forEach((mesh) => {
        mesh.position.copy(mesh.userData.targetPos);
        mesh.userData.prevPos.copy(mesh.userData.targetPos);
    });

    showGameOver(reason);
}

// 一次逻辑移动
function logicStep() {
    if (gameOver) return;

    const head = snake[0];
    let newHead = {
        x: head.x + direction.x,
        z: head.z + direction.z,
    };

    // 撞墙
    if (
        newHead.x > GRID_HALF ||
        newHead.x < -GRID_HALF ||
        newHead.z > GRID_HALF ||
        newHead.z < -GRID_HALF
    ) {
        triggerGameOver("hit wall");
        return;
    }

    // 撞自己
    if (snake.some((s) => s.x === newHead.x && s.z === newHead.z)) {
        triggerGameOver("hit itself");
        return;
    }

    // 撞障碍（考虑 2x2 的所有格子）
    if (obstacleOccupiesCell(newHead.x, newHead.z)) {
        triggerGameOver("hit obstacle");
        return;
    }

    // 吃到食物？
    let eatenIndex = -1;
    for (let i = 0; i < foods.length; i++) {
        if (foods[i].x === newHead.x && foods[i].z === newHead.z) {
            eatenIndex = i;
            break;
        }
    }

    if (eatenIndex >= 0) {
        const food = foods[eatenIndex];
        scene.remove(food.mesh);
        foods.splice(eatenIndex, 1);

        snake.unshift(newHead);
        score += 1;
        updateScore();
        ensureFoods();
    } else {
        snake.pop();
        snake.unshift(newHead);
    }

    updateSnakeTargets();
}

// 键盘控制
window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();

    if (k === "r") {
        resetGame();
        return;
    }

    if (gameOver) return;

    if (k === "w" && direction.z !== 1) direction = { x: 0, z: -1 };
    else if (k === "s" && direction.z !== -1) direction = { x: 0, z: 1 };
    else if (k === "a" && direction.x !== 1) direction = { x: -1, z: 0 };
    else if (k === "d" && direction.x !== -1) direction = { x: 1, z: 0 };
});

// 按钮点击重开
restartButton.addEventListener("click", () => {
    resetGame();
});

// 初始化
resetGame();

// 响应窗口大小变化
window.addEventListener("resize", () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
});

// 动画循环：时间步 + 插值
function animate(time) {
    requestAnimationFrame(animate);

    const dt = lastTime ? (time - lastTime) / 1000 : 0;
    lastTime = time;

    if (!gameOver) {
        moveTimer += dt;
        while (moveTimer >= MOVE_INTERVAL_SEC) {
            logicStep();
            moveTimer -= MOVE_INTERVAL_SEC;
        }

        if (moveProgress < 1) {
            moveProgress = Math.min(
                moveProgress + dt / MOVE_INTERVAL_SEC,
                1
            );
        }

        snakeMeshes.forEach((mesh) => {
            const prev = mesh.userData.prevPos;
            const target = mesh.userData.targetPos;
            mesh.position.lerpVectors(prev, target, moveProgress);
        });
    }

    foods.forEach((f) => {
        f.mesh.rotation.y += 0.03;
    });

    controls.update();
    renderer.render(scene, camera);
}

animate(0);
