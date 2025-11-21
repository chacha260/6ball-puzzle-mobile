import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Play, RotateCw, RotateCcw, ArrowLeft, ArrowRight, ArrowDown, ArrowUp, RefreshCw } from 'lucide-react';

// --- Constants & Types ---

const VISIBLE_ROWS = 15; 
const HIDDEN_ROWS = 5;   
const TOTAL_ROWS = VISIBLE_ROWS + HIDDEN_ROWS;
const COLS = 9; 
const BALL_RADIUS = 18; 
const HEX_WIDTH = BALL_RADIUS * 2;
const HEX_HEIGHT = BALL_RADIUS * Math.sqrt(3);
const ROW_HEIGHT = HEX_HEIGHT * 0.85; 

const COLORS = [
  '#FF4444', // Red
  '#4444FF', // Blue
  '#44AA44', // Green
  '#AA44AA', // Purple
  '#EEEE44', // Yellow
  '#44EEEE', // Cyan
];

const EMPTY = -1;

type Grid = number[][];

interface Position {
  r: number;
  c: number;
}

interface BallRelative {
  dx: number;
  dy: number;
  color: number;
}

interface FloatingPiece {
  x: number; 
  y: number; 
  balls: BallRelative[]; 
  rotationState: 0 | 1; // 0: InvTriangle(▽), 1: Triangle(△)
}

// --- Helper Functions ---

const getHexPos = (r: number, c: number) => {
  const visibleR = r - HIDDEN_ROWS;
  const isOdd = r % 2 !== 0;
  const x = c * HEX_WIDTH + (isOdd ? HEX_WIDTH / 2 : 0) + HEX_WIDTH / 2;
  const y = visibleR * ROW_HEIGHT + HEX_HEIGHT / 2;
  return { x, y };
};

const isValidPos = (r: number, c: number) => {
  if (r < 0 || r >= TOTAL_ROWS) return false;
  if (c < 0 || c >= COLS) return false;
  return true;
};

// ヘックスグリッド上の6方向の隣接マスを取得
const getNeighbors = (r: number, c: number) => {
  const isOdd = r % 2 !== 0;
  const neighbors: Position[] = [];
  
  const offsets = isOdd
    ? [
        { r: -1, c: 0 }, { r: -1, c: 1 }, // 上
        { r: 0, c: -1 }, { r: 0, c: 1 },  // 横 (Left, Right)
        { r: 1, c: 0 }, { r: 1, c: 1 }    // 下
      ]
    : [
        { r: -1, c: -1 }, { r: -1, c: 0 }, // 上
        { r: 0, c: -1 }, { r: 0, c: 1 },   // 横 (Left, Right)
        { r: 1, c: -1 }, { r: 1, c: 0 }    // 下
      ];

  for (const o of offsets) {
    const nr = r + o.r;
    const nc = c + o.c;
    if (isValidPos(nr, nc)) neighbors.push({ r: nr, c: nc });
  }
  return neighbors;
};

// 重力による落下時に影響する下の隣接マスを取得 (下方向)
const getBottomNeighbors = (r: number, c: number) => {
  const isOdd = r % 2 !== 0;
  if (isOdd) {
    return [{ r: r + 1, c: c }, { r: r + 1, c: c + 1 }];
  } else {
    return [{ r: r + 1, c: c - 1 }, { r: r + 1, c: c }];
  }
};

// ピラミッド判定で利用する上の隣接マスを取得 (上方向)
const getTopNeighbors = (r: number, c: number) => {
  const isOdd = r % 2 !== 0;
  if (isOdd) {
    return [{ r: r - 1, c: c }, { r: r - 1, c: c + 1 }];
  } else {
    return [{ r: r - 1, c: c - 1 }, { r: r - 1, c: c }];
  }
};

// --- Shape Detection Helpers within Group ---

// 特定のグループ内にヘキサゴン（リング）が含まれているかチェック
// 中心マスの色が何であれ、その周囲6マスがすべて groupSet に含まれていればOK
const hasHexagonInGroup = (groupSet: Set<string>, grid: Grid) => {
    // グリッド全体を走査して、その座標を中心としたリングがグループ内に存在するか確認
    // ※最適化のため、groupに含まれる座標の周辺だけ調べれば良いが、
    //   ここでは実装の単純化のため全探索に近い形をとるが、計算量は限定的。
    //   より効率的には「グループ内の各ボールの隣接マスの共通集合」などを探すが、
    //   ここでは「グリッド上の任意の有効座標を中心として、その隣接6個がすべてgroupSetにあるか」を見る。
    
    for (let r = 0; r < TOTAL_ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            // 中心 (r,c) はグループに含まれていなくてもよい（別色でもよい）
            const neighbors = getNeighbors(r, c);
            if (neighbors.length !== 6) continue; // 端はヘキサゴンにならない

            if (neighbors.every(n => groupSet.has(`${n.r},${n.c}`))) {
                return true;
            }
        }
    }
    return false;
};

// 特定のグループ内にピラミッドが含まれているかチェック
const hasPyramidInGroup = (groupSet: Set<string>) => {
    // グループ内の各点を頂点として、ピラミッドが構成できるかチェック
    // groupSet内の座標だけをループ対象にする
    for (const key of Array.from(groupSet)) {
        const [r, c] = key.split(',').map(Number);

        // 上向き (△) ピラミッドチェック: (r,c)が頂点
        // 2段目: 下2つ, 3段目: その下3つ
        if (checkPyramidStructure(r, c, groupSet, 'DOWN')) return true;

        // 下向き (▽) ピラミッドチェック: (r,c)が頂点
        // 2段目: 上2つ, 3段目: その上3つ
        if (checkPyramidStructure(r, c, groupSet, 'UP')) return true;
    }
    return false;
};

const checkPyramidStructure = (r: number, c: number, groupSet: Set<string>, dir: 'UP' | 'DOWN') => {
    const getNext = dir === 'DOWN' ? getBottomNeighbors : getTopNeighbors;
    
    // 1段目 (頂点) は呼び出し元で存在確認済み

    // 2段目
    const row2 = getNext(r, c);
    if (row2.length !== 2) return false;
    if (!row2.every(p => groupSet.has(`${p.r},${p.c}`))) return false;

    // 3段目
    const row3Candidates: Position[] = [];
    row3Candidates.push(...getNext(row2[0].r, row2[0].c));
    row3Candidates.push(...getNext(row2[1].r, row2[1].c));

    // 重複を除いて3つあるか
    const row3Unique = new Set<string>();
    const row3Points: Position[] = [];
    for(const p of row3Candidates) {
        const k = `${p.r},${p.c}`;
        if (!row3Unique.has(k)) {
            row3Unique.add(k);
            row3Points.push(p);
        }
    }
    if (row3Points.length !== 3) return false;
    
    // 3段目のチェック
    if (!row3Points.every(p => groupSet.has(`${p.r},${p.c}`))) return false;

    return true;
};

// 特定のグループ内にストレート（6個以上）が含まれているかチェック
// 対象：横、斜め右下、斜め左下 (縦ジグザグは対象外)
const hasStraightInGroup = (groupSet: Set<string>) => {
    // 探索方向: [dr, dc] ではない（奇数偶数で変わるため）。
    // 代わりに隣接取得ロジックを使ってチェーンを作る。
    // 3方向だけチェックすればよい（逆方向は始点を変えれば同じことなので）。
    // 1. 右 (Horizontal)
    // 2. 右下 (Diagonal Right)
    // 3. 左下 (Diagonal Left)

    for (const key of Array.from(groupSet)) {
        const [startR, startC] = key.split(',').map(Number);
        
        // 1. Horizontal Check (右方向)
        // ヘックスグリッドの配列上、同じ行の c+1 は右隣
        let count = 1;
        for (let k = 1; k < 6; k++) {
             if (groupSet.has(`${startR},${startC + k}`)) count++;
             else break;
        }
        if (count >= 6) return true;

        // 2. Diagonal Right Check (右下方向)
        count = 1;
        let currR = startR, currC = startC;
        for (let k = 1; k < 6; k++) {
            const neighbors = getBottomNeighbors(currR, currC);
            // 右下は neighbors[1]
            const next = neighbors[1];
            if (next && groupSet.has(`${next.r},${next.c}`)) {
                count++;
                currR = next.r;
                currC = next.c;
            } else break;
        }
        if (count >= 6) return true;

        // 3. Diagonal Left Check (左下方向)
        count = 1;
        currR = startR; currC = startC;
        for (let k = 1; k < 6; k++) {
            const neighbors = getBottomNeighbors(currR, currC);
            // 左下は neighbors[0]
            const next = neighbors[0];
            if (next && groupSet.has(`${next.r},${next.c}`)) {
                count++;
                currR = next.r;
                currC = next.c;
            } else break;
        }
        if (count >= 6) return true;
    }
    return false;
};

// --- Main Component ---

export default function SixBallPuzzle() {
  const [grid, setGrid] = useState<Grid>([]);
  const [activePiece, setActivePiece] = useState<FloatingPiece | null>(null);
  const [nextColors, setNextColors] = useState<number[]>([]);
  const [score, setScore] = useState(0);
  const [gameState, setGameState] = useState<'START' | 'PLAYING' | 'SETTLING' | 'GAME_OVER'>('START');
  const [message, setMessage] = useState('');
  const [comboMessage, setComboMessage] = useState(''); 

  const gridRef = useRef<Grid>([]);
  const requestRef = useRef<number>();
  const lastTimeRef = useRef<number>(0);
  const dropTimerRef = useRef<number>(0);
  const settleTimerRef = useRef<number>(0);
  const keysPressed = useRef<{ [key: string]: boolean }>({});
  
  const DROP_INTERVAL = 800; 
  const SETTLE_INTERVAL = 50; 
  const MOVE_SPEED_X = 0.015; 
  const MOVE_SPEED_Y = 0.02;

  // Initialize Game
  const initGame = useCallback(() => {
    const newGrid = Array.from({ length: TOTAL_ROWS }, () => Array(COLS).fill(EMPTY));
    setGrid(newGrid);
    gridRef.current = newGrid;
    setScore(0);
    
    const initialNext = generateNextColors();
    setNextColors(initialNext);
    spawnPiece(generateNextColors());
    
    setGameState('PLAYING');
    setMessage('');
    setComboMessage('');
  }, []);

  const generateNextColors = () => {
    return [
      Math.floor(Math.random() * COLORS.length),
      Math.floor(Math.random() * COLORS.length),
      Math.floor(Math.random() * COLORS.length)
    ];
  };

  const spawnPiece = (colors: number[]) => {
    const newPiece: FloatingPiece = {
      x: 3.5, 
      y: 2.0, 
      balls: [
        { dx: 0, dy: 0, color: colors[0] },       // Bottom
        { dx: -0.5, dy: -1, color: colors[1] },   // Top Left
        { dx: 0.5, dy: -1, color: colors[2] },    // Top Right
      ],
      rotationState: 0
    };
    setActivePiece(newPiece);
    setNextColors(generateNextColors());
  };

  // --- Physics Engine ---

  const runPhysicsStep = (currentGrid: Grid): { newGrid: Grid, moved: boolean } => {
    const newGrid = currentGrid.map(row => [...row]);
    let moved = false;
    
    for (let r = TOTAL_ROWS - 2; r >= 0; r--) {
      for (let c = 0; c < COLS; c++) {
        const color = newGrid[r][c];
        if (color === EMPTY) continue;

        const neighbors = getBottomNeighbors(r, c);
        const dl = neighbors[0]; // Down Left or Down
        const dr = neighbors[1]; // Down Right or Down

        let canGoDL = isValidPos(dl.r, dl.c) && newGrid[dl.r][dl.c] === EMPTY;
        let canGoDR = isValidPos(dr.r, dr.c) && newGrid[dr.r][dr.c] === EMPTY;

        if (canGoDL && canGoDR) {
           if (Math.random() < 0.5) {
             newGrid[dl.r][dl.c] = color;
             newGrid[r][c] = EMPTY;
           } else {
             newGrid[dr.r][dr.c] = color;
             newGrid[r][c] = EMPTY;
           }
           moved = true;
        } else if (canGoDL) {
          newGrid[dl.r][dl.c] = color;
          newGrid[r][c] = EMPTY;
          moved = true;
        } else if (canGoDR) {
          newGrid[dr.r][dr.c] = color;
          newGrid[r][c] = EMPTY;
          moved = true;
        }
      }
    }
    return { newGrid, moved };
  };

  // --- Match Checking Logic ---

  // BFSで連結成分（グループ）を取得する
  const getConnectedGroup = (startR: number, startC: number, grid: Grid, visitedGlobal: Set<string>) => {
      const color = grid[startR][startC];
      const group: Position[] = [];
      const queue: Position[] = [{ r: startR, c: startC }];
      const visitedLocal = new Set<string>();
      const startKey = `${startR},${startC}`;
      
      visitedLocal.add(startKey);
      visitedGlobal.add(startKey);
      group.push({ r: startR, c: startC });

      while (queue.length > 0) {
          const curr = queue.shift()!;
          const neighbors = getNeighbors(curr.r, curr.c);
          for (const n of neighbors) {
              const key = `${n.r},${n.c}`;
              if (!visitedGlobal.has(key) && !visitedLocal.has(key) && grid[n.r][n.c] === color) {
                  visitedLocal.add(key);
                  visitedGlobal.add(key);
                  group.push(n);
                  queue.push(n);
              }
          }
      }
      return group;
  };

  const checkMatches = (currentGrid: Grid): { newGrid: Grid, points: number } => {
    let nextGrid = currentGrid.map(row => [...row]);
    let totalPoints = 0;
    const visitedGlobal = new Set<string>();
    let maxComboName = '';
    let maxPriority = -1; // 0:Normal, 1:Straight, 2:Pyramid, 3:Hexagon

    // 1. 全連結成分を探索し、6個以上のグループをリストアップ
    for (let r = 0; r < TOTAL_ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            if (nextGrid[r][c] === EMPTY || visitedGlobal.has(`${r},${c}`)) continue;

            const group = getConnectedGroup(r, c, nextGrid, visitedGlobal);
            
            if (group.length >= 6) {
                // グループが見つかった場合、役の判定を行う
                const groupSet = new Set(group.map(p => `${p.r},${p.c}`));
                let isSpecial = false;
                let points = 0;
                let comboName = '';
                let priority = 0;

                // 優先順位: ヘキサゴン > ピラミッド > ストレート > 通常

                // 1. Hexagon Check
                if (hasHexagonInGroup(groupSet, nextGrid)) {
                    points = 1000;
                    comboName = 'ヘキサゴン！';
                    isSpecial = true;
                    priority = 3;
                }
                // 2. Pyramid Check
                else if (hasPyramidInGroup(groupSet)) {
                    points = 800;
                    comboName = 'ピラミッド！';
                    isSpecial = true;
                    priority = 2;
                }
                // 3. Straight Check (Vertical/Zigzag EXCLUDED)
                else if (hasStraightInGroup(groupSet)) {
                    points = 500;
                    comboName = 'ストレート！';
                    isSpecial = true;
                    priority = 1;
                }
                else {
                    // Normal Match
                    points = 0; // Base score calculated below
                    comboName = 'マッチ！';
                    priority = 0;
                }

                // Calculate Score
                // Base Points for clearing balls
                const ballPoints = group.length * 100 + (group.length - 6) * 50;
                totalPoints += ballPoints + points;

                // Update Combo Message Priority
                if (priority > maxPriority) {
                    maxPriority = priority;
                    maxComboName = comboName;
                }

                // Remove Balls
                // ※ ヘキサゴンの中心が別色の場合、その中心は group に含まれていないため消えない（仕様通り）
                // ※ 同色なら group に含まれるため消える（仕様通り）
                group.forEach(p => {
                    nextGrid[p.r][p.c] = EMPTY;
                });
            }
        }
    }

    if (maxComboName) {
        setComboMessage(maxComboName);
        setTimeout(() => setComboMessage(''), 1500);
    }
    
    return { newGrid: nextGrid, points: totalPoints };
  };


  // --- Game Loop ---

  const update = (time: number) => {
    if (gameState === 'GAME_OVER' || gameState === 'START') {
        requestRef.current = requestAnimationFrame(update);
        return;
    }

    const deltaTime = time - lastTimeRef.current;
    lastTimeRef.current = time;

    if (gameState === 'PLAYING') {
      // Handle continuous movement
      if (keysPressed.current['ArrowLeft'] || keysPressed.current['a'] || keysPressed.current['A']) {
        movePiece(-MOVE_SPEED_X * deltaTime, 0);
      }
      if (keysPressed.current['ArrowRight'] || keysPressed.current['d'] || keysPressed.current['D']) {
        movePiece(MOVE_SPEED_X * deltaTime, 0);
      }
      if (keysPressed.current['ArrowDown'] || keysPressed.current['s'] || keysPressed.current['S']) {
        movePiece(0, MOVE_SPEED_Y * deltaTime);
        dropTimerRef.current = 0; 
      }

      // Auto Drop
      dropTimerRef.current += deltaTime;
      if (dropTimerRef.current > DROP_INTERVAL) {
        movePiece(0, 1); 
        dropTimerRef.current = 0;
      }

    } else if (gameState === 'SETTLING') {
      settleTimerRef.current += deltaTime;
      if (settleTimerRef.current > SETTLE_INTERVAL) {
        const { newGrid, moved } = runPhysicsStep(gridRef.current);
        gridRef.current = newGrid;
        setGrid([...newGrid]); 
        
        if (!moved) {
          const matchResult = checkMatches(gridRef.current);
          if (matchResult.points > 0) {
            setScore(s => s + matchResult.points);
            gridRef.current = matchResult.newGrid;
            setGrid([...matchResult.newGrid]);
            // マッチが発生したら、再度落下・マッチ判定を行う（連鎖）
            settleTimerRef.current = 0; 
          } else {
            // 落下もマッチもなければ次のピースへ
            if (checkGameOver(gridRef.current)) {
              setGameState('GAME_OVER');
              setMessage('Game Over!');
            } else {
              setGameState('PLAYING');
              spawnPiece(nextColors);
            }
          }
        }
        settleTimerRef.current = 0;
      }
    }
    requestRef.current = requestAnimationFrame(update);
  };

  useEffect(() => {
    requestRef.current = requestAnimationFrame(update);
    return () => cancelAnimationFrame(requestRef.current!);
  }, [gameState]); 

  // --- Inputs ---

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (gameState !== 'PLAYING') return;
      keysPressed.current[e.key] = true;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) {
          e.preventDefault();
      }

      switch (e.key) {
        case 'ArrowUp': case 'w': case 'W': hardDrop(); break;
        case 'e': case 'E': rotatePiece('CW'); break;
        case 'q': case 'Q': rotatePiece('CCW'); break;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      keysPressed.current[e.key] = false;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [gameState]);

  // --- Logic Helpers ---

  const checkGameOver = (g: Grid) => {
    for (let r = 0; r < HIDDEN_ROWS; r++) {
        if (g[r].some(c => c !== EMPTY)) return true;
    }
    return false;
  };

  const checkCollision = (px: number, py: number, balls: BallRelative[]) => {
    for (const b of balls) {
      const r = Math.round(py + b.dy);
      const visualX = px + b.dx;
      const isOdd = r % 2 !== 0;
      
      const c = Math.floor(visualX - (isOdd ? 0.5 : 0));

      if (r >= TOTAL_ROWS) return true;
      if (c < 0 || c >= COLS) return true;
      if (r >= 0 && gridRef.current[r][c] !== EMPTY) return true;
    }
    return false;
  };

  const movePiece = (dx: number, dy: number) => {
    setActivePiece(prev => {
        if (!prev) return null;
        
        let nextX = prev.x;
        let nextY = prev.y;

        // 1. Horizontal Movement Check
        if (dx !== 0) {
            const testX = prev.x + dx;
            if (!checkCollision(testX, prev.y, prev.balls)) {
                nextX = testX;
            }
        }

        // 2. Vertical Movement Check
        if (dy !== 0) {
            const testY = prev.y + dy;
            if (!checkCollision(nextX, testY, prev.balls)) {
                nextY = testY;
            } else {
                if (dy > 0) {
                    // Wall Kick for gravity
                    const pushRightX = nextX + 0.5;
                    const pushLeftX = nextX - 0.5;

                    if (!checkCollision(pushRightX, testY, prev.balls)) {
                        return { ...prev, x: pushRightX, y: testY };
                    }
                    if (!checkCollision(pushLeftX, testY, prev.balls)) {
                        return { ...prev, x: pushLeftX, y: testY };
                    }

                    setTimeout(() => lockPiece({ ...prev, x: nextX, y: prev.y }), 0);
                    return null;
                }
            }
        }

        return { ...prev, x: nextX, y: nextY };
    });
  };

  const lockPiece = (piece: FloatingPiece) => {
    const newGrid = gridRef.current.map(row => [...row]);
    
    piece.balls.forEach(b => {
      const r = Math.round(piece.y + b.dy);
      const visualX = piece.x + b.dx;
      const isOdd = r % 2 !== 0;
      const c = Math.floor(visualX - (isOdd ? 0.5 : 0));

      if (r >= 0 && r < TOTAL_ROWS && c >= 0 && c < COLS) {
        newGrid[r][c] = b.color;
      }
    });

    gridRef.current = newGrid;
    setGrid(newGrid);
    setGameState('SETTLING'); 
  };

  const hardDrop = () => {
    setActivePiece(prev => {
        if (!prev) return null;
        let currentY = prev.y;
        while (!checkCollision(prev.x, currentY + 1, prev.balls)) {
          currentY += 1;
        }
        const droppedPiece = { ...prev, y: currentY };
        setTimeout(() => lockPiece(droppedPiece), 0);
        return null; 
    });
  };

  const rotatePiece = (dir: 'CW' | 'CCW') => {
    setActivePiece(prev => {
        if (!prev) return null;

        const nextState = prev.rotationState === 0 ? 1 : 0;
        
        const b0 = prev.balls[0]; 
        const b1 = prev.balls[1]; 
        const b2 = prev.balls[2]; 
        
        let newBalls: BallRelative[] = [];
        const shape0 = [{dx:0, dy:0}, {dx:-0.5, dy:-1}, {dx:0.5, dy:-1}]; 
        const shape1 = [{dx:0, dy:-1}, {dx:-0.5, dy:0}, {dx:0.5, dy:0}];
        
        const targetShape = nextState === 0 ? shape0 : shape1;
        
        let c0, c1, c2;
        if (prev.rotationState === 0) { 
            if (dir === 'CW') {
                c0 = b1.color; 
                c1 = b0.color; 
                c2 = b2.color; 
            } else { 
                c0 = b2.color; 
                c1 = b1.color; 
                c2 = b0.color; 
            }
        } else { 
            if (dir === 'CW') {
                c0 = b2.color; 
                c1 = b1.color; 
                c2 = b0.color; 
            } else { 
                c0 = b1.color; 
                c1 = b0.color; 
                c2 = b2.color; 
            }
        }
        
        newBalls = [
            { ...targetShape[0], color: c0 },
            { ...targetShape[1], color: c1 },
            { ...targetShape[2], color: c2 },
        ];

        if (checkCollision(prev.x, prev.y, newBalls)) {
            if (!checkCollision(prev.x - 0.5, prev.y, newBalls)) {
                return { ...prev, x: prev.x - 0.5, balls: newBalls, rotationState: nextState };
            }
            if (!checkCollision(prev.x + 0.5, prev.y, newBalls)) {
                return { ...prev, x: prev.x + 0.5, balls: newBalls, rotationState: nextState };
            }
            return prev;
        }

        return { ...prev, balls: newBalls, rotationState: nextState };
    });
  };

  // --- Rendering ---

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center font-sans select-none touch-none">
      
      <div className="mb-4 text-center">
        <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500">
          6-Ball Puzzle
        </h1>
        <p className="text-xs text-gray-400 mt-1">A/D: 移動 | Q/E: 回転 | S: ソフトドロップ | W: ハードドロップ</p>
      </div>

      <div className="flex flex-col md:flex-row gap-8 items-start">
        
        <div className="relative bg-gray-800 border-4 border-gray-700 rounded-lg overflow-hidden shadow-2xl"
             style={{ width: COLS * HEX_WIDTH + HEX_WIDTH/2, height: VISIBLE_ROWS * ROW_HEIGHT + HEX_HEIGHT }}>
          
          {/* Grid Background */}
          <div className="absolute inset-0 opacity-20 pointer-events-none">
            {Array.from({ length: VISIBLE_ROWS }).map((_, r) => (
              Array.from({ length: COLS }).map((_, c) => {
                const pos = getHexPos(r + HIDDEN_ROWS, c);
                return (
                  <div key={`${r}-${c}`} 
                       className="absolute border border-gray-500 rounded-full"
                       style={{
                         width: BALL_RADIUS * 2,
                         height: BALL_RADIUS * 2,
                         left: pos.x - BALL_RADIUS,
                         top: pos.y - BALL_RADIUS,
                       }} 
                  />
                );
              })
            ))}
          </div>
          
          {/* Game Over Line */}
          <div 
             className="absolute w-full border-b-4 border-red-600 border-dashed z-0 pointer-events-none opacity-70"
             style={{
                top: 0, 
             }}
          />

          {/* Placed Balls */}
          {grid.map((row, r) => 
            row.map((colorIdx, c) => {
              if (colorIdx === EMPTY) return null;
              
              const pos = getHexPos(r, c);
              const isHidden = r < HIDDEN_ROWS;
              
              if (r < HIDDEN_ROWS - 2) return null;

              return (
                <div
                  key={`ball-${r}-${c}`}
                  className={`absolute rounded-full shadow-md transition-all duration-200 ${isHidden ? 'opacity-50 grayscale-[0.5]' : ''}`}
                  style={{
                    width: BALL_RADIUS * 2,
                    height: BALL_RADIUS * 2,
                    left: pos.x - BALL_RADIUS,
                    top: pos.y - BALL_RADIUS,
                    backgroundColor: COLORS[colorIdx],
                    backgroundImage: 'radial-gradient(circle at 30% 30%, rgba(255,255,255,0.4), transparent 70%)',
                    boxShadow: `inset -2px -2px 6px rgba(0,0,0,0.3), 1px 1px 2px rgba(0,0,0,0.5)`,
                    zIndex: isHidden ? 5 : 1 
                  }}
                />
              );
            })
          )}

          {/* Active Piece */}
          {activePiece && gameState === 'PLAYING' && activePiece.balls.map((b, i) => {
            const r = activePiece.y + b.dy;
            const visualX = activePiece.x + b.dx;

            if (r < HIDDEN_ROWS - 2) return null;

            const visibleR = r - HIDDEN_ROWS;
            const xPos = visualX * HEX_WIDTH;
            const yPos = visibleR * ROW_HEIGHT + HEX_HEIGHT / 2;

            return (
               <div
                  key={`active-${i}`}
                  className="absolute rounded-full shadow-xl z-10"
                  style={{
                    width: BALL_RADIUS * 2,
                    height: BALL_RADIUS * 2,
                    left: xPos - BALL_RADIUS,
                    top: yPos - BALL_RADIUS,
                    backgroundColor: COLORS[b.color],
                    backgroundImage: 'radial-gradient(circle at 30% 30%, rgba(255,255,255,0.8), transparent 70%)',
                    boxShadow: `0 4px 6px rgba(0,0,0,0.3)`
                  }}
                />
            );
          })}
          
          {/* Combo Message Overlay */}
          {comboMessage && (
            <div className="absolute inset-0 flex items-center justify-center z-50 pointer-events-none">
              <div className="text-4xl font-extrabold text-yellow-300 bg-black/50 px-4 py-2 rounded-lg shadow-2xl animate-pulse">
                {comboMessage}
              </div>
            </div>
          )}

          {/* Game Over Overlay */}
          {gameState === 'GAME_OVER' && (
            <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center z-50 animate-in fade-in">
              <h2 className="text-4xl font-bold text-red-500 mb-4">GAME OVER</h2>
              <p className="text-xl mb-6">最終スコア: {score}</p>
              <button onClick={initGame} className="flex items-center gap-2 px-6 py-3 bg-white text-black rounded-full font-bold hover:scale-105 transition">
                <RefreshCw size={20} /> もう一度プレイ
              </button>
            </div>
          )}

           {gameState === 'START' && (
            <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center z-50">
              <h2 className="text-4xl font-bold text-blue-400 mb-8">準備OK?</h2>
              <button onClick={initGame} className="flex items-center gap-2 px-8 py-4 bg-blue-600 text-white rounded-full font-bold hover:bg-blue-500 transition shadow-lg hover:shadow-blue-500/50">
                <Play size={24} /> ゲーム開始
              </button>
            </div>
          )}

        </div>

        {/* Sidebar */}
        <div className="flex flex-col md:flex-row gap-8 items-start">
          
          {/* Score Panel */}
          <div className="bg-gray-800 p-4 rounded-xl border border-gray-700 shadow-lg">
            <h3 className="text-gray-400 text-sm uppercase font-bold mb-1">スコア</h3>
            <p className="text-3xl font-mono text-green-400">{score}</p>
          </div>

          {/* Next Piece Preview */}
          <div className="bg-gray-800 p-4 rounded-xl border border-gray-700 shadow-lg flex flex-col items-center h-40 justify-center">
             <h3 className="text-gray-400 text-sm uppercase font-bold mb-4 w-full text-left">ネクスト</h3>
             <div className="relative w-24 h-24">
               {/* Visualizing the next triangle (State 0) */}
               {[
                 {x: 40, y: 60, c: nextColors[0]}, // Bottom
                 {x: 20, y: 25, c: nextColors[1]}, // Top Left
                 {x: 60, y: 25, c: nextColors[2]}  // Top Right
               ].map((p, i) => (
                  <div key={i} 
                       className="absolute w-8 h-8 rounded-full border border-black/20"
                       style={{
                         backgroundColor: COLORS[p.c],
                         left: p.x,
                         top: p.y,
                         backgroundImage: 'radial-gradient(circle at 30% 30%, rgba(255,255,255,0.5), transparent 70%)'
                       }} 
                  />
               ))}
             </div>
          </div>

           {/* Mobile Controls */}
            <div className="md:hidden mt-4 w-full flex flex-col gap-2">
                <h3 className="text-gray-400 text-sm uppercase font-bold mb-1">操作</h3>
                <div className="flex justify-center gap-2">
                    <button onClick={() => rotatePiece('CCW')} className="p-3 bg-gray-700 rounded-lg hover:bg-gray-600 transition">
                        <RotateCcw size={20} />
                    </button>
                    <button onClick={() => movePiece(-0.5, 0)} className="p-3 bg-gray-700 rounded-lg hover:bg-gray-600 transition">
                        <ArrowLeft size={20} />
                    </button>
                    <button onClick={() => movePiece(0.5, 0)} className="p-3 bg-gray-700 rounded-lg hover:bg-gray-600 transition">
                        <ArrowRight size={20} />
                    </button>
                    <button onClick={() => rotatePiece('CW')} className="p-3 bg-gray-700 rounded-lg hover:bg-gray-600 transition">
                        <RotateCw size={20} />
                    </button>
                </div>
                <div className="flex justify-center gap-2">
                     <button onClick={() => movePiece(0, 1)} className="p-3 bg-blue-600 rounded-lg hover:bg-blue-500 transition w-1/3 flex items-center justify-center gap-1">
                        <ArrowDown size={20} /> ソフトドロップ
                    </button>
                     <button onClick={hardDrop} className="p-3 bg-red-600 rounded-lg hover:bg-red-500 transition w-1/3 flex items-center justify-center gap-1">
                        <ArrowUp size={20} /> ハードドロップ
                    </button>
                </div>
            </div>
          
        </div>
      </div>
    </div>
  );
}
