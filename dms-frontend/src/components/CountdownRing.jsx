export default function CountdownRing({ pct, expired, triggered }) {
  const r   = 54;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - Math.max(0, Math.min(1, pct)));

  const color = triggered
    ? '#e05252'
    : expired
    ? '#e05252'
    : pct < 0.2
    ? '#f0a030'
    : '#2dbd6e';

  return (
    <svg width="140" height="140" className="countdown-ring">
      <circle className="ring-track" cx="70" cy="70" r={r} />
      <circle
        className="ring-progress"
        cx="70" cy="70" r={r}
        stroke={color}
        strokeDasharray={circ}
        strokeDashoffset={triggered ? circ : offset}
      />
    </svg>
  );
}
