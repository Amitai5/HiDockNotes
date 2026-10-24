// Adapted from sgeraldes/hidock-next-2 @ 31d44da (MIT).
import { WebUSB } from 'usb'
import { JensenDevice as ProtocolDevice } from '@hidock/jensen-protocol'
import { guardNativeUsb } from './native-usb-guard'

// The desktop supplies only transport; library state and processing live on the server.
const webusb = guardNativeUsb(new WebUSB({ allowAllDevices: true }) as unknown as USB)
export class JensenDevice extends ProtocolDevice {
  constructor(usb: USB = webusb) { super(usb) }
}
