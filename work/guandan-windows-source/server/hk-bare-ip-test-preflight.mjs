import { validateHongKongBareIpTestProfile } from './hk-bare-ip-profile.js'

const result = validateHongKongBareIpTestProfile(process.env)
console.log('Hong Kong bare-IP test profile verified.')
console.log(JSON.stringify(result, null, 2))
