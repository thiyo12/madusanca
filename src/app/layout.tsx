import './globals.css';
import type { Metadata } from 'next';
export const metadata:Metadata={title:'Wisdom Driving Academy | Driving Lessons in Canada',description:'Build confidence behind the wheel. Professional driving lessons and flexible online booking.'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
