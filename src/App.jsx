import { useState, useEffect, useRef } from 'react'
import './App.css'

// Collision boundaries (in percentages of track height)
const CAR_TOP = 83; // Matches 100% - 5% (bottom) - 12% (height)
const CAR_BOTTOM = 95; // Matches 100% - 5% (bottom)
const OBS_HEIGHT = 8; 

function App() {
  const [speed, setSpeed] = useState(1);
  const [carLane, setCarLane] = useState(1); // 0 (left), 1 (center), 2 (right)
  const [obstacles, setObstacles] = useState([]);
  const [crashes, setCrashes] = useState(0);
  
  // Dashboard Metrics State
  const [distance, setDistance] = useState(0);
  const [timeStr, setTimeStr] = useState("00:00");
  const [score, setScore] = useState(0);
  const [isShaking, setIsShaking] = useState(false);
  const [isPlaying, setIsPlaying] = useState(true);

  // Use ref to keep mutable state for the requestAnimationFrame loop
  const stateRef = useRef({
    speed: 1,
    carLane: 1,
    obstacles: [],
    crashes: 0,
    lastSpawnTime: 0,
    isPlaying: true,
    
    // Metrics variables
    startTime: Date.now(),
    lastFrameTime: Date.now(),
    accumulatedDistance: 0,
    lastUIUpdate: 0
  });

  // Keep ref synced with react state
  useEffect(() => {
    stateRef.current.speed = speed;
    stateRef.current.carLane = carLane;
    stateRef.current.crashes = crashes;
    stateRef.current.isPlaying = isPlaying;
  }, [speed, carLane, crashes, isPlaying]);

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!stateRef.current.isPlaying) return; // Ignore input when paused

      if (e.key === 'ArrowLeft') {
        setCarLane(prev => Math.max(0, prev - 1));
      } else if (e.key === 'ArrowRight') {
        setCarLane(prev => Math.min(2, prev + 1));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
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
        // Freeze time when paused so there are no sudden jumps when unpaused
        state.startTime += deltaTime;
        state.lastSpawnTime += deltaTime;
        state.lastUIUpdate += deltaTime;
        animationFrameId = requestAnimationFrame(gameLoop);
        return;
      }
      
      // Calculate accumulated distance (base 20 meters per second at 1x speed)
      state.accumulatedDistance += (20 * state.speed * (deltaTime / 1000));
      
      // Spawn new obstacles
      const SPAWN_RATE_MS = 1000;
      if (timestamp - state.lastSpawnTime > (SPAWN_RATE_MS / state.speed)) {
        const newObs = {
          id: timestamp, // unique ID
          lane: Math.floor(Math.random() * 3),
          top: -10, // start slightly above the screen
          hasCollided: false
        };
        state.obstacles.push(newObs);
        state.lastSpawnTime = timestamp;
      }

      let newCrashes = state.crashes;
      let collisionJustHappened = false;

      // Update positions and check collisions
      state.obstacles = state.obstacles.filter(obs => {
        // Move down based on speed
        obs.top += 0.4 * state.speed; // adds % of track height per frame

        // Basic bounding box collision
        if (!obs.hasCollided && obs.lane === state.carLane) {
          const obsBottom = obs.top + OBS_HEIGHT;
          if (obsBottom > CAR_TOP && obs.top < CAR_BOTTOM) {
            obs.hasCollided = true;
            newCrashes += 1;
            collisionJustHappened = true;
          }
        }

        // Despawn if it moves past the bottom of the track (110%)
        return obs.top < 110;
      });

      // Update crashes & UI feedback if changed
      if (newCrashes !== state.crashes) {
        setCrashes(newCrashes);
      }
      
      if (collisionJustHappened) {
        setIsShaking(true);
        setTimeout(() => setIsShaking(false), 300);
      }
      
      // UI Updates throttled to 100ms for performance
      if (now - state.lastUIUpdate > 100) {
        setDistance(Math.floor(state.accumulatedDistance));
        
        // Format Elapsed Time
        const elapsedTotalSeconds = Math.floor((now - state.startTime) / 1000);
        const m = Math.floor(elapsedTotalSeconds / 60).toString().padStart(2, '0');
        const s = (elapsedTotalSeconds % 60).toString().padStart(2, '0');
        setTimeStr(`${m}:${s}`);
        
        // Calculate Score (Distance * 10 minus 500 penalty per crash)
        const currentScore = Math.floor(state.accumulatedDistance * 10) - (state.crashes * 500);
        setScore(Math.max(0, currentScore));
        
        state.lastUIUpdate = now;
      }

      // We must copy the array to trigger a React render with the new positions
      setObstacles([...state.obstacles]);

      animationFrameId = requestAnimationFrame(gameLoop);
    };

    animationFrameId = requestAnimationFrame(gameLoop);
    return () => cancelAnimationFrame(animationFrameId);
  }, []);

  // Helper for lane positioning
  const getLaneLeftOffset = (laneIndex) => {
    if (laneIndex === 0) return '16.66%';
    if (laneIndex === 1) return '50%';
    return '83.33%';
  };

  return (
    <div className={`app-container ${isShaking ? 'shake' : ''}`}>
      {/* Left Panel: Gameplay */}
      <div className="gameplay-panel">
        <div className="track-container" style={{ animationDuration: `${2 / speed}s` }}>
          <div className="track-lanes">
            <div className="lane"></div>
            <div className="lane"></div>
            <div className="lane"></div>
            
            {/* Player Car */}
            <div 
              className="player-car" 
              style={{ 
                left: getLaneLeftOffset(carLane),
                bottom: '5%',
                height: '12%',
                transform: 'translateX(-50%)'
              }}
            ></div>

            {/* Obstacles */}
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
        
        {/* Speed & Play Controls */}
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

      {/* Right Panel: Dashboard */}
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
            <div className="metric-title">Crashes</div>
            <div className="metric-value">{crashes}</div>
          </div>
          
          <div className="metric-card">
            <div className="metric-title">Time Elapsed</div>
            <div className="metric-value">{timeStr}</div>
          </div>
          
          <div className="metric-card">
            <div className="metric-title">Score</div>
            <div className="metric-value">{score}</div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
