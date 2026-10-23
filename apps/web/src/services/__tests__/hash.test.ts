import { expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { Sha256 } from '../hash'
it.each([0,1,55,56,63,64,65,1024,1048577])('matches SHA-256 across arbitrary chunks for %i bytes',length=>{const data=Buffer.alloc(length);for(let i=0;i<length;i++)data[i]=i%251;const hash=new Sha256();for(let i=0;i<data.length;i+=53)hash.update(data.subarray(i,i+53));expect(hash.digest()).toBe(createHash('sha256').update(data).digest('hex'))})
