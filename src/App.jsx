import { useState, useEffect, useRef } from 'react'
import './App.css'

const CAR_TOP = 83;
const CAR_BOTTOM = 95;
const OBS_HEIGHT = 8; 

function App() {
  const [speed, setSpeed] = useState(1);
  const [carLane, setCarLane] = useState(1);
  const [obstacles, setObstacles] = useState([]);
  const [crashes, setCrashes] = useState(0);
  const [obstaclesPassed, setObstaclesPassed] = useState(0);
  const [dodges, setDodges] = useState(0);
  
  const [distance, setDistance] = useState(0);
  const [timeStr, setTimeStr] = useState("00:00");
  const [score, setScore] = useState(0);
  const [isShaking, setIsShaking] = useState(false);
  const [isPlaying, setIsPlaying] = useState(true);
  
  const [aiLogs, setAiLogs] = useState([]);
  const [copied, setCopied] = useState(false);
  const logsEndRef = useRef(null);

  const handleCopyLogs = () => {
    if (aiLogs.length === 0) return;
    navigator.clipboard.writeText(aiLogs.join('\n')).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(err => {
      console.error("Failed to copy logs:", err);
    });
  };

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [aiLogs]);

  const stateRef = useRef({
    speed: 1,
    carLane: 1,
    obstacles: [],
    crashes: 0,
    obstaclesPassed: 0,
    dodges: 0,
    lastSpawnTime: 0,
    isPlaying: true,
    startTime: Date.now(),
    lastFrameTime: Date.now(),
    accumulatedDistance: 0,
    lastUIUpdate: 0
  });

  useEffect(() => {
    stateRef.current.speed = speed;
    stateRef.current.carLane = carLane;
    stateRef.current.crashes = crashes;
    stateRef.current.obstaclesPassed = obstaclesPassed;
    stateRef.current.dodges = dodges;
    stateRef.current.isPlaying = isPlaying;
  }, [speed, carLane, crashes, obstaclesPassed, dodges, isPlaying]);

  // AI Controller Loop
  useEffect(() => {
    let timeoutId;
    let isActive = true;
    let isFetching = false;

    const askAI = async () => {
      const state = stateRef.current;
      
      if (!state.isPlaying || isFetching) {
        if (isActive) timeoutId = setTimeout(askAI, 200);
        return;
      }

      // AI vision: 43% ahead for early reaction (car at 83%, vision starts at 40%)
      const AI_VISION = CAR_TOP - 43;
      const imminentObstacles = state.obstacles.filter(obs => obs.top >= AI_VISION && obs.top < CAR_BOTTOM);
      const obstacleData = imminentObstacles.map(obs => ({ lane: obs.lane, top: Math.round(obs.top) }));
      
      try {
        isFetching = true;
        const response = await fetch("http://localhost:5000/predict", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            carLane: state.carLane,
            obstacles: obstacleData
          })
        });
        const data = await response.json();
        
        if (isActive && data.direction) {
           const choice = data.direction;
           if (choice === 'left') {
              setCarLane(prev => Math.max(0, prev - 1));
              setDodges(prev => prev + 1);
           } else if (choice === 'right') {
              setCarLane(prev => Math.min(2, prev + 1));
              setDodges(prev => prev + 1);
           }
           
           if (data.log) {
             const laneDesc = state.carLane === 0 ? "LEFT" : (state.carLane === 1 ? "CENTER" : "RIGHT");
             const laneBreakdown = [0, 1, 2].map(l => obstacleData.filter(o => o.lane === l).length);
             setAiLogs(prev => {
                const envInfo = `Car: ${laneDesc} | Vision(43%): ${obstacleData.length} (L:${laneBreakdown[0]} C:${laneBreakdown[1]} R:${laneBreakdown[2]})`;
                const newLogs = [...prev, `[AI] ${envInfo} => Action: ${data.log.choice.toUpperCase()}`];
                return newLogs.slice(-50);
             });
           }
        }
      } catch (err) {
        console.error("AI Request Failed (Make sure python ai_controller is running!):", err);
      } finally {
        isFetching = false;
        if (isActive) {
           timeoutId = setTimeout(askAI, 100); // Poll every 100ms for faster reactions
        }
      }
    };

    askAI();

    return () => {
      isActive = false;
      clearTimeout(timeoutId);
    };
  }, []);

  // Main Game Engine Loop
  useEffect(() => {
    let animationFrameId;

    const gameLoop = (timestamp) => {
      const state = stateRef.current;
      const now = Date.now();
      const deltaTime = now - state.lastFrameTime;
      state.lastFrameTime = now;
      
      if (!state.isPlaying) {
        state.startTime += deltaTime;
        state.lastSpawnTime += deltaTime;
        state.lastUIUpdate += deltaTime;
        animationFrameId = requestAnimationFrame(gameLoop);
        return;
      }
      
      state.accumulatedDistance += (20 * state.speed * (deltaTime / 1000));
      
      const SPAWN_RATE_MS = 1200;
      if (now - state.lastSpawnTime > (SPAWN_RATE_MS / state.speed)) {
        // --- Realistic Obstacle Spawning ---
        // Rule 1: Never block all 3 lanes simultaneously.
        //   Check which lanes already have a "fresh" obstacle near the top of the screen.
        const VERTICAL_GAP = 25; // Minimum % gap between obstacles in the same wave
        const freshObs = state.obstacles.filter(o => o.top < VERTICAL_GAP);
        const freshLanes = new Set(freshObs.map(o => o.lane));
        
        // Rule 2: Pick a lane that keeps at least 1 lane always free.
        let availableLanes = [0, 1, 2];
        if (freshLanes.size >= 2) {
          // Two lanes already have fresh obstacles — do NOT spawn a third one this cycle.
          // Skip spawning entirely to give a breathing gap.
          state.lastSpawnTime = now;
        } else {
          // If 1 fresh obstacle exists, exclude one more lane at random to keep variety,
          // but always allow at least 2 candidate lanes.
          if (freshLanes.size === 1) {
            availableLanes = availableLanes.filter(l => !freshLanes.has(l));
          }
          
          // Rule 3: Enforce min vertical spacing per lane to avoid stacked blocks
          const MIN_LANE_GAP = 30;
          availableLanes = availableLanes.filter(l => {
            const lastInLane = state.obstacles.filter(o => o.lane === l).sort((a, b) => a.top - b.top)[0];
            return !lastInLane || lastInLane.top >= MIN_LANE_GAP;
          });

          if (availableLanes.length > 0) {
            const chosenLane = availableLanes[Math.floor(Math.random() * availableLanes.length)];
            const newObs = {
              id: now,
              lane: chosenLane,
              top: -10,
              hasCollided: false
            };
            state.obstacles.push(newObs);
          }
          state.lastSpawnTime = now;
        }
      }

      let newCrashes = state.crashes;
      let collisionJustHappened = false;

      let newPassed = state.obstaclesPassed;

      state.obstacles = state.obstacles.filter(obs => {
        obs.top += 0.4 * state.speed;

        if (!obs.hasCollided && obs.lane === state.carLane) {
          const obsBottom = obs.top + OBS_HEIGHT;
          if (obsBottom > CAR_TOP && obs.top < CAR_BOTTOM) {
            obs.hasCollided = true;
            newCrashes += 1;
            collisionJustHappened = true;
          }
        }
        // Count obstacle as "passed" when it exits the screen
        if (obs.top >= 110) {
          newPassed += 1;
          return false;
        }
        return true;
      });

      if (newPassed !== state.obstaclesPassed) {
        setObstaclesPassed(newPassed);
      }

      if (newCrashes !== state.crashes) {
        setCrashes(newCrashes);
      }
      
      if (collisionJustHappened) {
        setIsShaking(true);
        setTimeout(() => setIsShaking(false), 300);

        // Capture blocks within the 15% vision window only
        const VISION_START = CAR_TOP - 15;
        const nearbyObs = state.obstacles.filter(o => o.top >= VISION_START && o.top < CAR_BOTTOM);
        const laneDesc = state.carLane === 0 ? "LEFT" : (state.carLane === 1 ? "CENTER" : "RIGHT");
        const laneBreakdown = [0, 1, 2].map(l => nearbyObs.filter(o => o.lane === l).length);
        
        setAiLogs(prev => {
           const logMsg = `[CRASH] 💥 Car: ${laneDesc} | Nearby(15%): ${nearbyObs.length} (L:${laneBreakdown[0]} C:${laneBreakdown[1]} R:${laneBreakdown[2]})`;
           return [...prev, logMsg].slice(-50);
        });
      }
      
      if (now - state.lastUIUpdate > 100) {
        setDistance(Math.floor(state.accumulatedDistance));
        
        const elapsedTotalSeconds = Math.floor((now - state.startTime) / 1000);
        const m = Math.floor(elapsedTotalSeconds / 60).toString().padStart(2, '0');
        const s = (elapsedTotalSeconds % 60).toString().padStart(2, '0');
        setTimeStr(`${m}:${s}`);
        
        const currentScore = Math.floor(state.accumulatedDistance * 10) - (state.crashes * 500);
        setScore(Math.max(0, currentScore));
        
        state.lastUIUpdate = now;
      }

      setObstacles([...state.obstacles]);
      animationFrameId = requestAnimationFrame(gameLoop);
    };

    animationFrameId = requestAnimationFrame(gameLoop);
    return () => cancelAnimationFrame(animationFrameId);
  }, []);

  const getLaneLeftOffset = (laneIndex) => {
    if (laneIndex === 0) return '16.66%';
    if (laneIndex === 1) return '50%';
    return '83.33%';
  };

  return (
    <div className={`app-container ${isShaking ? 'shake' : ''}`}>
      <div className="gameplay-panel">
        <div className="track-container" style={{ animationDuration: `${2 / speed}s` }}>
          <div className="track-lanes">
            <div className="lane"></div>
            <div className="lane"></div>
            <div className="lane"></div>
            
            <div 
              className="player-car" 
              style={{ 
                left: getLaneLeftOffset(carLane),
                bottom: '5%',
                height: '12%',
                transform: 'translateX(-50%)'
              }}
            ></div>

            {obstacles.map(obs => (
              <div 
                key={obs.id}
                className={`obstacle ${obs.hasCollided ? 'collided' : ''}`}
                style={{
                  left: getLaneLeftOffset(obs.lane),
                  top: `${obs.top}%`,
                  height: `${OBS_HEIGHT}%`,
                  transform: 'translateX(-50%)'
                }}
              ></div>
            ))}
          </div>
        </div>
        
        <div className="speed-control">
          <button 
            style={{ backgroundColor: isPlaying ? 'var(--danger)' : '#10b981', marginRight: 'auto' }} 
            onClick={() => setIsPlaying(!isPlaying)}
          >
            {isPlaying ? 'Stop' : 'Play'}
          </button>
          
          <button onClick={() => setSpeed(s => Math.max(0.5, s - 0.5))}>Slower</button>
          <span>Speed: {speed.toFixed(1)}x</span>
          <button onClick={() => setSpeed(s => Math.min(3, s + 0.5))}>Faster</button>
        </div>
      </div>

      <div className="dashboard-panel">
        <div className="dashboard-header">
          <h1>Street Racer</h1>
          <p>Minimalist Web Racing Experience</p>
        </div>

        <div className="metrics-grid">
          <div className="metric-card">
            <div className="metric-title">Distance Covered</div>
            <div className="metric-value">{distance} m</div>
          </div>
          
          <div className="metric-card">
            <div className="metric-title">Obstacles Passed</div>
            <div className="metric-value">{obstaclesPassed}</div>
          </div>

          <div className="metric-card">
            <div className="metric-title">Crashes</div>
            <div className="metric-value">{crashes}</div>
          </div>

          <div className="metric-card">
            <div className="metric-title">Dodges</div>
            <div className="metric-value">{dodges}</div>
          </div>
          
          <div className="metric-card">
            <div className="metric-title">Time Elapsed</div>
            <div className="metric-value">{timeStr}</div>
          </div>
          
          <div className={`metric-card ${(() => {
            const total = obstaclesPassed;
            if (total === 0) return '';
            const rate = (crashes / total) * 100;
            return rate <= 10 ? 'metric-card--good' : rate <= 25 ? 'metric-card--warn' : 'metric-card--danger';
          })()}`}>
            <div className="metric-title">Crash Rate</div>
            <div className="metric-value">
              {obstaclesPassed === 0 ? '—' : `${((crashes / obstaclesPassed) * 100).toFixed(1)}%`}
            </div>
            <div className="metric-subtitle">
              {obstaclesPassed > 0 ? `${crashes} / ${obstaclesPassed} obstacles` : 'Waiting for data...'}
            </div>
          </div>

          <div className="metric-card">
            <div className="metric-title">Score</div>
            <div className="metric-value">{score}</div>
          </div>
        </div>

        {/* AI Logs */}
        <div className="ai-logs-panel">
          <div className="ai-logs-header">
            <div className="ai-logs-title">
              <span className="live-indicator"></span>
              <span>Live AI Steering Logs</span>
              <span className="ai-logs-count">({aiLogs.length})</span>
            </div>
            <button 
              className={`copy-logs-btn ${copied ? 'copied' : ''}`}
              onClick={handleCopyLogs}
              disabled={aiLogs.length === 0}
              title="Copy all logs to clipboard"
            >
              {copied ? '✓ Copied' : '📋 Copy Logs'}
            </button>
          </div>
          <div className="ai-logs-container">
            {aiLogs.length === 0 ? (
              <div className="ai-logs-empty">Waiting for steering decisions from AI controller...</div>
            ) : (
              aiLogs.map((log, i) => (
                <div key={i} className="ai-log-line">{log}</div>
              ))
            )}
            <div ref={logsEndRef} />
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
