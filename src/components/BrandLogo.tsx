export function BrandLogo({ className = "" }: { className?: string }) {
  return <img className={`pulcip-logo ${className}`.trim()} src="/pulcip.svg" alt="Pulcip" width={3162} height={599} draggable={false} />;
}
