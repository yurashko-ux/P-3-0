import type { Config } from 'tailwindcss'
export default {content:['./app/**/*.{ts,tsx}','./components/**/*.{ts,tsx}'],theme:{extend:{colors:{primary:{DEFAULT:'#2563EB',hover:'#1D4ED8',ring:'#93C5FD'}},borderRadius:{'2xl':'1rem'}}},plugins:[],} satisfies Config;
