import Grainient from "./Grainient";

export default function Classes() {
  return (
    <aside>
      <Grainient
        color1="#99edff"
        color2="#bfff00"
        color3="#99edff"
        timeSpeed={0.4}
        colorBalance={0}
        warpStrength={1}
        warpFrequency={5.5}
        warpSpeed={2.2}
        warpAmplitude={50}
        blendAngle={0}
        blendSoftness={0.05}
        rotationAmount={520}
        noiseScale={4}
        grainAmount={0.1}
        grainScale={2}
        grainAnimated={false}
        contrast={1.5}
        gamma={1}
        saturation={1}
        centerX={0.06}
        centerY={0}
        zoom={1}
      />
      <div className="rail-ui">
        <span className="brand">YADL</span>
        <p className="lede">Agent authors the pose. You review. The product is labeled data.</p>
        <p className="eyebrow">Dataset</p>
        <h1>Classes</h1>
      </div>
    </aside>
  );
}
