'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useState } from 'react';

export default function NotFound() {
  const router = useRouter();
  const [birdClicked, setBirdClicked] = useState(false);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Backspace') {
        e.preventDefault();
        router.back();
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        router.push('/');
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [router]);

  const handleBirdClick = () => {
    setBirdClicked(true);
    setTimeout(() => setBirdClicked(false), 300);
  };

  return (
    <div className="bg-gray-50 min-h-[calc(100vh-64px)] flex items-center justify-center overflow-hidden relative">
      {/* Custom animation styles */}
      <style>{`
        @keyframes float {
          0%, 100% {
            transform: translateY(0px) rotate(0deg);
            filter: drop-shadow(0 0 10px #e4c34c);
          }
          50% {
            transform: translateY(-20px) rotate(5deg);
            filter: drop-shadow(0 0 20px #30c3c6);
          }
        }
        .float-animation {
          animation: float 3s ease-in-out infinite;
        }
      `}</style>

      <div className="container mx-auto px-6 text-center relative z-10">
        {/* Main Bird Logo */}
        <div
          className={`mb-8 flex justify-center float-animation cursor-pointer transition-transform duration-300 ${birdClicked ? 'scale-120 rotate-10' : ''}`}
          onClick={handleBirdClick}
          style={birdClicked ? { transform: 'scale(1.2) rotate(10deg)' } : undefined}
        >
          <div className="w-24 h-24 bg-white rounded-full flex items-center justify-center shadow-lg">
            <img src="/logo.svg" alt="" className="w-16 h-auto" />
          </div>
        </div>

        {/* 404 Error Code */}
        <div className="mb-6">
          <h1 className="text-8xl md:text-9xl font-bold text-gray-800 mb-4">
            4<span className="text-gray-500">0</span>4
          </h1>
          <div className="text-2xl md:text-3xl font-semibold text-gray-600 mb-2">
            Oops! This bird has flown away
          </div>
        </div>

        {/* Error Message */}
        <div className="mb-8 max-w-md mx-auto">
          <p className="text-lg text-gray-600 mb-4 leading-relaxed">
            The page you&apos;re looking for seems to have taken flight.
          </p>
          <p className="text-gray-600">
            Think this is a mistake?{' '}
            <a
              href="https://github.com/jacerniello/cashchirp/issues"
              target="_blank"
              rel="noreferrer"
              className="text-green hover:underline"
            >
              Open an issue on GitHub
            </a>
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
          <button
            onClick={() => router.back()}
            className="bg-white text-gray-800 px-8 py-3 rounded-full font-semibold hover:bg-gray-100 transform hover:scale-105 transition-all duration-200 shadow-md hover:shadow-lg"
          >
            &larr; Go Back
          </button>
          <Link
            href="/"
            className="bg-gray-800 text-white px-8 py-3 rounded-full font-semibold hover:bg-gray-700 transform hover:scale-105 transition-all duration-200 shadow-md hover:shadow-lg no-underline"
          >
            Home
          </Link>
        </div>

        {/* Fun Facts */}
        <div className="mt-12 text-gray-500 text-sm">
          <p className="mb-2">Fun Fact: Many birds can see ultraviolet light.</p>
          <p>Also, did you know hummingbirds can fly backwards?</p>
        </div>
      </div>
    </div>
  );
}
