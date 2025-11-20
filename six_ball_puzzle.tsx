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
  
  // r-1, r, r+1 の順に、c方向のオフセットを定義
  const offsets = isOdd
    ? [
        { r: -1, c: 0 }, { r: -1, c: 1 }, // 上
        { r: 0, c: -1 }, { r: 0, c: 1 },  // 横
        { r: 1, c: 0 }, { r: 1, c: 1 }    // 下
      ]
    : [
        { r: -1, c: -1 }, { r: -1, c: 0 }, // 上
        { r: 0, c: -1 }, { r: 0, c: 1 },   // 横
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
  // r+1 の行への移動
  if (isOdd) {
    return [{ r: r + 1, c: c }, { r: r + 1, c: c + 1 }];
  } else {
    return [{ r: r + 1, c: c - 1 }, { r: r + 1, c: c }];
  }
};

// ピラミッド判定で利用する上の隣接マスを取得 (上方向)
const getTopNeighbors = (r: number, c: number) => {
  const isOdd = r % 2 !== 0;
  // r-1 の行への移動
  if (isOdd) {
    return [{ r: r - 1, c: c }, { r: r - 1, c: c + 1 }];
  } else {
    return [{ r: r - 1, c: c - 1 }, { r: r - 1, c: c }];
  }
};

// --- Pattern Matching Helpers (役の判定) ---

// ヘックスグリッドの隣接ルールの違いを考慮したディレクション取得
const getDirectionVector = (r: number, dirIndex: number) => {
    const isOdd = r % 2 !== 0;
    
    // ヘックスグリッドの6方向の相対座標を取得
    const offsets = isOdd ? [
        { dr: -1, dc: 0 },  // 0: 上
        { dr: -1, dc: 1 },  // 1: 上右
        { dr: 0, dc: 1 },   // 2: 右
        { dr: 1, dc: 1 },   // 3: 下右
        { dr: 1, dc: 0 },   // 4: 下
        { dr: 0, dc: -1 }   // 5: 左
    ] : [
        { dr: -1, dc: -1 }, // 0: 上左
        { dr: -1, dc: 0 },  // 1: 上
        { dr: 0, dc: 1 },   // 2: 右
        { dr: 1, dc: 0 },   // 3: 下
        { dr: 1, dc: -1 },  // 4: 下左
        { dr: 0, dc: -1 }   // 5: 左
    ];

    return offsets[dirIndex] || { dr: 0, dc: 0 };
};

/**
 * ヘキサゴン（外側6個）の判定
 * 中心(r, c)の周囲6マスがすべて同じ色で構成されている
 * 中心ボールの色は問わない（EMPTYでも何色でもOK）
 * @param centerR 中心点の行
 * @param centerC 中心点の列
 * @param color チェックする外側ボールの色
 * @returns 成立したボールのPosition配列 (6個または7個) または null
 */
const checkHexagon = (currentGrid: Grid, centerR: number, centerC: number, color: number): Position[] | null => {
    // 1. 周囲の6マスをチェックし、すべて color と一致するか確認
    const neighbors = getNeighbors(centerR, centerC);
    
    // 周囲に6マスがない場合はヘキサゴンにはなり得ない
    if (neighbors.length !== 6) return null; 

    const hexGroup: Position[] = []; 
    let allNeighborsMatch = true;

    for (const n of neighbors) {
        // 周囲のボールの色は、引数の color (チェック対象の色) と一致する必要がある
        if (isValidPos(n.r, n.c) && currentGrid[n.r][n.c] === color) {
            hexGroup.push(n);
        } else {
            // 1つでも色が違うか、グリッド外・EMPTYならヘキサゴンではない（外側6個の条件が満たされない）
            allNeighborsMatch = false;
            break;
        }
    }

    if (!allNeighborsMatch) return null; 
    
    // 6個の外側ボールが成立
    if (hexGroup.length === 6) {
        // 2. 中心ボールの状態を確認 (中心はあってもなくても、何色でもよい)
        const centerColor = currentGrid[centerR][centerC];
        if (centerColor !== EMPTY) {
            // 中心にボールがある場合は、それも消去対象に追加し、7個マッチとする
            hexGroup.push({r: centerR, c: centerC});
        }
        
        // 成立した外側6個と、あれば中心1個（合計6個または7個）を返す
        return hexGroup;
    }

    return null;
};

/**
 * 指定された方向のピラミッド（正三角形 6個）の判定
 * @param r 頂点（最上段/最下段）の行
 * @param c 頂点（最上段/最下段）の列
 * @param color チェックするボールの色
 * @param direction 'DOWN' (△ 上向き) または 'UP' (▽ 下向き)
 * @returns 成立したボールのPosition配列 (6個) または null
 */
const checkPyramidDirectional = (currentGrid: Grid, r: number, c: number, color: number, direction: 'UP' | 'DOWN'): Position[] | null => {
    // 1段目 (頂点) のチェック
    if (currentGrid[r][c] !== color) return null;

    const pyramidGroup: Position[] = [{ r, c }]; // 頂点
    
    const getNextLevelNeighbors = direction === 'DOWN' ? getBottomNeighbors : getTopNeighbors;

    // --- 2段目 (2個) ---
    const row2Candidates = getNextLevelNeighbors(r, c);
    if (row2Candidates.length !== 2) return null; 
    
    const pos2A = row2Candidates[0];
    const pos2B = row2Candidates[1];

    if (!isValidPos(pos2A.r, pos2A.c) || currentGrid[pos2A.r][pos2A.c] !== color) return null;
    if (!isValidPos(pos2B.r, pos2B.c) || currentGrid[pos2B.r][pos2B.c] !== color) return null;
    
    pyramidGroup.push(pos2A, pos2B);

    // --- 3段目 (3個) ---
    const row3Candidates: Position[] = [];
    row3Candidates.push(...getNextLevelNeighbors(pos2A.r, pos2A.c));
    row3Candidates.push(...getNextLevelNeighbors(pos2B.r, pos2B.c));

    const row3Keys = new Set<string>();
    const row3Unique: Position[] = [];

    for (const p of row3Candidates) {
        if (!isValidPos(p.r, p.c)) continue; 
        const key = `${p.r},${p.c}`;
        if (!row3Keys.has(key)) {
            row3Keys.add(key);
            row3Unique.push(p);
        }
    }

    if (row3Unique.length !== 3) return null; // 3段目は必ず3個の一意なマスで構成されるはず

    // 3段目の3マスが全て color であることをチェック
    for (const p of row3Unique) {
        if (currentGrid[p.r][p.c] !== color) {
            return null;
        }
        pyramidGroup.push(p);
    }

    // 6個のボールすべてが同じ色で構成されている
    return pyramidGroup.length === 6 ? pyramidGroup : null;
};

/**
 * ピラミッド（△ 上向き または ▽ 下向き 6個）の判定
 * @param r 頂点となる行
 * @param c 頂点となる列
 * @param color チェックするボールの色
 * @returns 成立したボールのPosition配列 (6個) または null
 */
const checkPyramid = (currentGrid: Grid, r: number, c: number, color: number): Position[] | null => {
    // 1. 上向きピラミッド (△: 頂点が上, 底辺が下) のチェック
    let match = checkPyramidDirectional(currentGrid, r, c, color, 'DOWN');
    if (match) return match;
    
    // 2. 下向きピラミッド (▽: 頂点が下, 底辺が上) のチェック
    // 判定の中心となるマス(r, c)が、下向きピラミッドの頂点となる場合をチェック
    match = checkPyramidDirectional(currentGrid, r, c, color, 'UP');
    return match;
};

// ストレート（直線）の判定
const checkStraight = (currentGrid: Grid, r: number, c: number, color: number): Position[] | null => {
    // 判定の中心となるボールの色をチェック
    if (currentGrid[r][c] === EMPTY || currentGrid[r][c] !== color) {
        return null;
    }

    // 6方向（3軸）をチェック
    for (let i = 0; i < 3; i++) {
        const dir1Index = i;
        const dir2Index = i + 3; // 反対方向 (e.g., 0:上 <-> 3:下)

        const centerPos: Position = {r, c};
        const group: Position[] = [centerPos]; // 中心ボール

        // dir1 方向への接続数をカウント
        let count1 = 0;
        for (let k = 1; k < 6; k++) {
            const dir = getDirectionVector(r, dir1Index);
            const nr = r + dir.dr * k;
            const nc = c + dir.dc * k;
            // IMPORTANT: 同じ色であることと、有効な座標であることをチェック
            if (isValidPos(nr, nc) && currentGrid[nr][nc] === color) {
                count1++;
                group.push({ r: nr, c: nc });
            } else {
                break;
            }
        }
        
        // dir2 方向への接続数をカウント
        let count2 = 0;
        for (let k = 1; k < 6; k++) {
            const dir = getDirectionVector(r, dir2Index);
            // 軸の判定開始行は中心ボールの行rを基準にする
            const nr = r + dir.dr * k;
            const nc = c + dir.dc * k;
            // IMPORTANT: 同じ色であることと、有効な座標であることをチェック
            if (isValidPos(nr, nc) && currentGrid[nr][nc] === color) {
                count2++;
                group.push({ r: nr, c: nc });
            } else {
                break;
            }
        }

        // 中心 (r, c) を含めて合計6個以上（6個ストレート）
        // 役として成立するのは6個以上の場合のみ
        if (count1 + count2 + 1 >= 6) {
            // ストレートとして消去するボールのリストを返す
            return group;
        }
    }
    return null;
};

// --- Main Component ---

export default function SixBallPuzzle() {
  const [grid, setGrid] = useState<Grid>([]);
  const [activePiece, setActivePiece] = useState<FloatingPiece | null>(null);
  const [nextColors, setNextColors] = useState<number[]>([]);
  const [score, setScore] = useState(0);
  const [gameState, setGameState] = useState<'START' | 'PLAYING' | 'SETTLING' | 'GAME_OVER'>('START');
  const [message, setMessage] = useState('');
  // 新しいステート：成立した役のメッセージ表示用
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
    // Start at x=3.5 to align with Even Row center (0.5, 1.5, 2.5, 3.5...)
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
           // どちらにも移動できる場合はランダムに選択して落下
           if (Math.random() < 0.5) {
             newGrid[dl.r][dl.c] = color;
             newGrid[r][c] = EMPTY;
           } else {
             newGrid[dr.r][dr.c] = color;
             newGrid[r][c] = EMPTY;
           }
           moved = true;
        } else if (canGoDL) {
          // 左下に移動
          newGrid[dl.r][dl.c] = color;
          newGrid[r][c] = EMPTY;
          moved = true;
        } else if (canGoDR) {
          // 右下に移動
          newGrid[dr.r][dr.c] = color;
          newGrid[r][c] = EMPTY;
          moved = true;
        }
      }
    }
    return { newGrid, moved };
  };

  // 役の判定とマッチ処理を統合
  const checkMatches = (currentGrid: Grid): { newGrid: Grid, points: number } => {
    let nextGrid = currentGrid.map(row => [...row]);
    let totalPoints = 0;
    const matchedPositions = new Set<string>();
    const getPosKey = (r: number, c: number) => `${r},${c}`;
    
    // 役のメッセージとポイント
    let currentComboMessage = '';
    const BASE_MATCH_POINTS = 100;
    const STRAIGHT_BONUS = 500;
    const PYRAMID_BONUS = 800; 
    const HEXAGON_BONUS = 1000;

    // 全てのセルを走査して役をチェック
    for (let r = 0; r < TOTAL_ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const color = nextGrid[r][c];
            if (color === EMPTY) continue; // ボールがなければスキップ
            
            // 既にマッチ済みならスキップ (役が重複しないようにする)
            if (matchedPositions.has(getPosKey(r, c))) continue; 
            
            let matchGroup: Position[] | null = null;
            let bonusPoints = 0;
            let comboName = '';
            
            // --- ここで、ヘキサゴン、ストレート、ピラミッドの順にチェックを行う ---
            
            // 1. ヘキサゴン（外側6個）のチェック
            
            const neighbors = getNeighbors(r, c);
            if (neighbors.length === 6) {
                // 外側6個のボールの色を取得
                const neighborColors = neighbors.map(n => nextGrid[n.r][n.c]);
                // EMPTYでないボールが6個あるかを確認
                const nonEmptyNeighbors = neighborColors.filter(nc => nc !== EMPTY);
                
                if (nonEmptyNeighbors.length === 6 && nonEmptyNeighbors.every(nc => nc === nonEmptyNeighbors[0])) {
                    const hexagonColor = nonEmptyNeighbors[0];
                    const hexagonMatch = checkHexagon(nextGrid, r, c, hexagonColor);
                    
                    if (hexagonMatch) {
                        // ボール数が多い役を優先して処理
                        matchGroup = hexagonMatch;
                        bonusPoints = HEXAGON_BONUS;
                        comboName = 'ヘキサゴン！';
                    }
                }
            }


            // 2. ストレート（直線 6個以上）のチェック
            if (!matchGroup) {
                const straightMatch = checkStraight(nextGrid, r, c, color);
                if (straightMatch && straightMatch.length >= 6) { 
                    matchGroup = straightMatch;
                    bonusPoints = STRAIGHT_BONUS;
                    comboName = 'ストレート！';
                }
            }

            // 3. ピラミッド（△/▽ 6個）のチェック
            if (!matchGroup) {
                // r, c を頂点として判定
                const pyramidMatch = checkPyramid(nextGrid, r, c, color);
                if (pyramidMatch) {
                    matchGroup = pyramidMatch;
                    bonusPoints = PYRAMID_BONUS;
                    comboName = 'ピラミッド！';
                }
            }

            // マッチが成立したら、消去リストに追加し、ポイントを加算
            if (matchGroup) {
                // 重複排除チェック
                const isNewMatch = matchGroup.every(p => !matchedPositions.has(getPosKey(p.r, p.c)));
                
                if (isNewMatch) {
                    matchGroup.forEach(p => matchedPositions.add(getPosKey(p.r, p.c)));
                    totalPoints += matchGroup.length * BASE_MATCH_POINTS + bonusPoints;
                    currentComboMessage = comboName; // 最後に成立した役の名前
                }
            }
        }
    }
    
    // 4. 通常の6個以上マッチ（役なし）のチェック (連鎖・通常消去用)
    const visited = new Set<string>(matchedPositions); // 既に役でマッチしたボールはスキップ
    const regularMatches: Position[] = [];

    for (let r = 0; r < TOTAL_ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (nextGrid[r][c] === EMPTY || visited.has(getPosKey(r, c))) continue;

        const color = nextGrid[r][c];
        const group: Position[] = [];
        const queue: Position[] = [{ r, c }];
        visited.add(getPosKey(r, c));
        group.push({ r, c });

        while (queue.length > 0) {
          const curr = queue.shift()!;
          const neighbors = getNeighbors(curr.r, curr.c);
          for (const n of neighbors) {
            if (nextGrid[n.r][n.c] === color && !visited.has(getPosKey(n.r, n.c))) {
              visited.add(getPosKey(n.r, n.c));
              group.push(n);
              queue.push(n);
            }
          }
        }

        // 通常マッチも6個以上で成立
        if (group.length >= 6) {
          regularMatches.push(...group);
          group.forEach(p => matchedPositions.add(getPosKey(p.r, p.c)));
        }
      }
    }

    if (regularMatches.length > 0) {
        // 通常マッチの場合
        totalPoints += regularMatches.length * BASE_MATCH_POINTS + (regularMatches.length - 6) * 50; 
        currentComboMessage = currentComboMessage || 'マッチ！'; // 役がない場合のみ設定
    }
    
    // 5. 消去処理
    if (matchedPositions.size > 0) {
      matchedPositions.forEach(key => {
        const [r, c] = key.split(',').map(Number);
        nextGrid[r][c] = EMPTY;
      });
      
      // 役が成立していたらメッセージをセット
      if (currentComboMessage) {
        setComboMessage(currentComboMessage);
        // メッセージを一定時間後に消去
        setTimeout(() => setComboMessage(''), 1000); 
      }
      
      return { newGrid: nextGrid, points: totalPoints };
    }
    
    return { newGrid: currentGrid, points: 0 };
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
            settleTimerRef.current = 0; // すぐに次の物理ステップへ
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
      
      // cの計算はHEXグリッドのオフセットを考慮
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
            } else {
                // Wall slide handling is implicit: we just don't update X, but we allow Y below
            }
        }

        // 2. Vertical Movement Check
        if (dy !== 0) {
            const testY = prev.y + dy;
            if (!checkCollision(nextX, testY, prev.balls)) {
                nextY = testY;
            } else {
                // Collision when moving vertically.
                
                // Special Case: Hex Grid "Zigzag" Wall Collision.
                
                if (dy > 0) {
                    // Try auto-correcting X position (Wall Kick for gravity)
                    // If we push Left or Right slightly, can we fall?
                    const pushRightX = nextX + 0.5;
                    const pushLeftX = nextX - 0.5;

                    // Check if pushing Right fixes it (e.g. hitting Left wall)
                    if (!checkCollision(pushRightX, testY, prev.balls)) {
                        return { ...prev, x: pushRightX, y: testY };
                    }
                    // Check if pushing Left fixes it (e.g. hitting Right wall)
                    if (!checkCollision(pushLeftX, testY, prev.balls)) {
                        return { ...prev, x: pushLeftX, y: testY };
                    }

                    // If we still collide, it's a real floor/ball collision.
                    // Only lock if it was a pure vertical move (or forced drop).
                    // To prevent instant lock on wall slide, we ensure we really can't go down.
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
        // Fall until collision
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
        // ▽ (InvTriangle) shape
        const shape0 = [{dx:0, dy:0}, {dx:-0.5, dy:-1}, {dx:0.5, dy:-1}]; 
        // △ (Triangle) shape
        const shape1 = [{dx:0, dy:-1}, {dx:-0.5, dy:0}, {dx:0.5, dy:0}];
        
        const targetShape = nextState === 0 ? shape0 : shape1;
        
        // Rotate colors 60 degrees
        let c0, c1, c2;
        if (prev.rotationState === 0) { // ▽ -> △
            if (dir === 'CW') {
                c0 = b1.color; // Top gets TL
                c1 = b0.color; // BL gets Bot
                c2 = b2.color; // BR gets TR
            } else { // CCW
                c0 = b2.color; // Top gets TR
                c1 = b1.color; // BL gets TL
                c2 = b0.color; // BR gets Bot
            }
        } else { // △ -> ▽
            if (dir === 'CW') {
                c0 = b2.color; // Bot gets BR
                c1 = b1.color; // TL gets BL
                c2 = b0.color; // TR gets Top
            } else { // CCW
                c0 = b1.color; // Bot gets BL
                c1 = b0.color; // TL gets Top
                c2 = b2.color; // TR gets BR
            }
        }
        
        newBalls = [
            { ...targetShape[0], color: c0 },
            { ...targetShape[1], color: c1 },
            { ...targetShape[2], color: c2 },
        ];

        // Wall Kick (Simple): If rotation hits wall, try shifting left/right
        if (checkCollision(prev.x, prev.y, newBalls)) {
            // Try shifting Left
            if (!checkCollision(prev.x - 0.5, prev.y, newBalls)) {
                return { ...prev, x: prev.x - 0.5, balls: newBalls, rotationState: nextState };
            }
            // Try shifting Right
            if (!checkCollision(prev.x + 0.5, prev.y, newBalls)) {
                return { ...prev, x: prev.x + 0.5, balls: newBalls, rotationState: nextState };
            }
            // Can't rotate
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
          
          {/* Game Over Line (Red Dashed) */}
          <div 
             className="absolute w-full border-b-4 border-red-600 border-dashed z-0 pointer-events-none opacity-70"
             style={{
                // Position exactly at top of visible area.
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

           {/* Mobile Controls (Hidden on desktop, shown on mobile) */}
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
