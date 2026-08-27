import Canvas from "@/components/Canvas";
import Classes from "@/components/Classes";
import Header from "@/components/Header";

export default function Home() {
  return (
    <div className="shell">
      <Header />
      <Classes />
      <Canvas />
    </div>
  );
}
