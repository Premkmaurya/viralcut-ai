import React, { useState } from 'react';
import { X, Search, FileText, Clock } from 'lucide-react';

export default function TranscriptViewer({ jobId, onClose }) {
  const [transcript, setTranscript] = useState(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [error, setError] = useState('');

  React.useEffect(() => {
    async function fetchTranscript() {
      try {
        const res = await fetch(`/api/jobs/${jobId}/transcript`);
        if (!res.ok) {
          throw new Error('Transcript not yet available or failed to load.');
        }
        const data = await res.json();
        setTranscript(data.transcript);
        setLoading(false);
      } catch (err) {
        setError(err.message);
        setLoading(false);
      }
    }
    fetchTranscript();
  }, [jobId]);

  const formatTime = (secs) => {
    const s = Math.floor(secs);
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}:${rem.toString().padStart(2, '0')}`;
  };

  const filteredSegments = (transcript?.segments || []).filter(s =>
    s.text.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#0f172a] border border-slate-800 rounded-3xl w-full max-w-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <FileText className="w-5 h-5 text-rose-500" />
            <h3 className="text-base font-bold text-white">Full Video Transcript</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search */}
        <div className="p-4 border-b border-slate-800/80 bg-slate-900/50">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search words in transcript..."
              className="w-full pl-10 pr-4 py-2 bg-slate-900 border border-slate-700/80 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-rose-500"
            />
          </div>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-3">
          {loading ? (
            <div className="text-center py-12 text-slate-400 text-xs">
              Loading timestamped transcript segments...
            </div>
          ) : error ? (
            <div className="text-center py-12 text-red-400 text-xs">
              {error}
            </div>
          ) : filteredSegments.length === 0 ? (
            <div className="text-center py-12 text-slate-500 text-xs">
              No matching transcript segments found.
            </div>
          ) : (
            filteredSegments.map((seg) => (
              <div
                key={seg.id}
                className="flex items-start space-x-3 p-3 rounded-xl bg-slate-900/60 hover:bg-slate-900 border border-slate-800/80 transition"
              >
                <div className="flex items-center space-x-1 font-mono text-[11px] text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded shrink-0 border border-rose-500/20">
                  <Clock className="w-3 h-3" />
                  <span>{formatTime(seg.start)}</span>
                </div>
                <p className="text-xs text-slate-200 leading-relaxed">{seg.text}</p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
