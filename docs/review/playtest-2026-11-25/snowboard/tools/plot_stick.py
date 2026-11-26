# Stick figures of the real rig (joint world positions dumped from the real sim + skierView by vitest).
import json, math, numpy as np, matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
D = json.load(open('/workspace/apex-playtest/2026-11-25/snowboard/rig_sim_joints.json'))
OUT = '/workspace/apex-playtest/2026-11-25/snowboard/stick/'
chains = {'front/left leg': (['thigh_L', 'shin_L', 'ankle_L'], 'tab:blue'), 'back/right leg': (['thigh_R', 'shin_R', 'ankle_R'], 'tab:green'),
          'torso': (['hips', 'spine', 'chest', 'head', 'headTop'], 'tab:red'), 'arm L': (['upperarm_L', 'forearm_L', 'hand_L'], 'tab:orange'), 'arm R': (['upperarm_R', 'forearm_R', 'hand_R'], 'tab:purple'),
          'hipbar': (['thigh_L', 'hips', 'thigh_R'], 'tab:red')}
for d in D:
    J = {k: np.array(v) for k, v in d['joints'].items()}
    up = np.array([0, 1, math.tan(math.radians(18))]); up /= np.linalg.norm(up)  # slope normal (18° test slope)
    fwd = np.array([d['vx'], 0, d['vz']]); fwd -= up * fwd.dot(up); fwd /= np.linalg.norm(fwd)
    if d['model'] == 'board':
        board = np.array(d['eq']['board']); c = board[:4].mean(0)
        toe = np.array(d['eq']['toe'][1]) - np.array(d['eq']['toe'][0]); toe -= up * toe.dot(up); toe -= fwd * toe.dot(fwd); toe /= np.linalg.norm(toe)
    else:
        c = (J['ankle_L'] + J['ankle_R']) / 2; c[1] -= 0.2
        toe = np.cross(up, fwd)  # skier's left, just an axis
    B = lambda p: np.array([(p - c).dot(fwd), (p - c).dot(up), (p - c).dot(toe)])  # along, up, toe
    fig, axs = plt.subplots(1, 3, figsize=(13, 4.8))
    views = [('FRONT: from the toe side (chest view), slope frame\n→ nose', 0, 1, False), ('PROFILE: from behind along travel\n→ toe side', 2, 1, False), ('TOP: looking down\n→ nose, ↑ toe side', 0, 2, False)]
    for ax, (title, h, v, _) in zip(axs, views):
        for name, (bones, col) in chains.items():
            pts = np.array([B(J[b]) for b in bones])
            ax.plot(pts[:, h], pts[:, v], '-o', color=col, lw=3 if 'leg' in name else 2, ms=4, label=name if ax is axs[0] and name != 'hipbar' else None)
        for k in ['shin_L', 'shin_R']:
            p = B(J[k]); ax.annotate('knee', (p[h], p[v]), fontsize=7)
        for key, pts in d['eq'].items():
            if key == 'toe': continue
            P = np.array([B(np.array(p)) for p in pts]); ax.plot(P[:, h], P[:, v], '-', color='k', lw=2)
        if d['model'] == 'board':
            t0 = B(np.array(d['eq']['toe'][0])); t1 = B(np.array(d['eq']['toe'][1]))
        ax.axhline(0 if v == 1 else 0, color='0.85', lw=0.8)
        ax.set_aspect('equal'); ax.set_title(title, fontsize=9); ax.grid(alpha=0.3)
        ax.set_xlim(-1.1, 1.1); ax.set_ylim(-0.6 if v == 2 else -0.4, 1.9 if v == 1 else 0.8)
    m = d.get('m') or {}
    turn = 'straight' if abs(d['steer']) < 0.5 else ('TOE-SIDE (steer right)' if d['steer'] > 0 else 'HEEL-SIDE (steer left)')
    if d['brake']: turn = 'BRAKE (S)'
    if d['air']: turn = 'AIR (pop)'
    sub = f"{d['model']} · {d['name']} t={d['t']}s · {turn} · {d['kmh']} km/h · sim edge {d['edge_deg']}°"
    if m: sub += f"\nedge down: {m.get('edge_down')} roll {m.get('board_roll_deg')}° · knee-bend dir vs boot toe: front {m.get('front_knee_bend_vs_bootToe_deg')}° back {m.get('back_knee_bend_vs_bootToe_deg')}° (0 = over toes, 180 = over heels) · knee flex {m.get('front_knee_flex_deg')}/{m.get('back_knee_flex_deg')}°"
    fig.suptitle(sub, fontsize=9); axs[0].legend(fontsize=7, loc='upper left')
    fig.tight_layout(); fn = f"{OUT}{d['model']}_{d['name']}_t{d['t']}.png"; fig.savefig(fn, dpi=80); plt.close(fig); print(fn)
