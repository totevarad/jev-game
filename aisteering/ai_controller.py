from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

@app.route('/predict', methods=['POST'])
def predict():
    data = request.json
    car_lane = data.get("carLane", 1)
    all_obstacles = data.get("obstacles", [])

    # ─── Vision Zones ───────────────────────────────────────
    # Car is at 83%.  We scan from 40% to 95% (the full approach corridor).
    VISION_START = 40
    CAR_TOP      = 83
    CAR_BOTTOM   = 95

    visible = [
        obs for obs in all_obstacles
        if VISION_START <= obs.get("top", 0) < CAR_BOTTOM
    ]

    # Two-tier threat assessment:
    #   • Imminent  (top >= 60%)  – obstacle is close, must dodge NOW
    #   • Approaching (40-60%)    – obstacle is coming, dodge early
    IMMINENT_THRESHOLD = 60

    imminent   = [obs for obs in visible if obs["top"] >= IMMINENT_THRESHOLD]
    approaching = [obs for obs in visible if obs["top"] < IMMINENT_THRESHOLD]

    imminent_lanes    = set(obs["lane"] for obs in imminent)
    approaching_lanes = set(obs["lane"] for obs in approaching)
    all_danger_lanes  = imminent_lanes | approaching_lanes

    safe_from_imminent = [l for l in [0, 1, 2] if l not in imminent_lanes]
    safe_from_all      = [l for l in [0, 1, 2] if l not in all_danger_lanes]

    lane_names = {0: "LEFT", 1: "CENTER", 2: "RIGHT"}

    # ─── Decision Logic ─────────────────────────────────────
    action = "stay"
    reason = "Lane is clear"

    if car_lane in imminent_lanes:
        # URGENT: obstacle is about to hit us — must dodge NOW
        if safe_from_imminent:
            # Prefer lanes that are also clear of approaching obstacles
            best_safe = [l for l in safe_from_imminent if l in safe_from_all]
            if not best_safe:
                best_safe = safe_from_imminent
            target = min(best_safe, key=lambda l: abs(l - car_lane))
            action = "left" if target < car_lane else "right"
            reason = f"IMMINENT obstacle! Dodging {action.upper()} to {lane_names[target]}"
        else:
            # All lanes have imminent obstacles — pick the least crowded
            lane_counts = {l: sum(1 for obs in imminent if obs["lane"] == l) for l in [0, 1, 2]}
            best_lane = min(lane_counts, key=lane_counts.get)
            if best_lane != car_lane:
                action = "left" if best_lane < car_lane else "right"
                reason = f"All lanes blocked! Dodging {action.upper()} (least crowded)"
            else:
                reason = "All lanes blocked, current is safest"

    elif car_lane in approaching_lanes:
        # Obstacle heading our way — dodge early
        if safe_from_all:
            target = min(safe_from_all, key=lambda l: abs(l - car_lane))
            action = "left" if target < car_lane else "right"
            reason = f"Obstacle approaching! Early dodge {action.upper()} to {lane_names[target]}"
        elif safe_from_imminent:
            target = min(safe_from_imminent, key=lambda l: abs(l - car_lane))
            action = "left" if target < car_lane else "right"
            reason = f"Obstacle approaching! Dodge {action.upper()} to clearer {lane_names[target]}"
        else:
            reason = "Obstacles everywhere, holding lane"

    # ─── Logging ─────────────────────────────────────────────
    vis_str = ", ".join(
        f"L{obs['lane']}@{obs['top']:.0f}%"
        for obs in sorted(visible, key=lambda o: o["top"])
    )
    print(f"[STEER] Car:{lane_names[car_lane]} | "
          f"Visible:{len(visible)} [{vis_str}] | "
          f"Action:{action.upper()} | {reason}")

    return jsonify({
        "direction": action,
        "log": {
            "state": reason,
            "choice": action
        }
    })


if __name__ == '__main__':
    print("Starting AI Controller Server on port 5000...")
    print("Mode: DETERMINISTIC (rule-based, no LLM latency)")
    app.run(port=5000)
