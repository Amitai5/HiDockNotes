import brandMark from '../assets/brand-mark.png'

export function BrandMark({ size = 36 }: { size?: number }): JSX.Element {
  return <img className="brand-mark" src={brandMark} width={size} height={size} alt="" aria-hidden="true" draggable={false} />
}
