import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { learner } from '@/lib/learningEngine';

interface MemoryViewProps {
  onImport?: () => void;
}

export default function MemoryView({ onImport }: MemoryViewProps) {
  const [fileContent, setFileContent] = useState('');
  const [importStatus, setImportStatus] = useState('');
  const [memoryStats, setMemoryStats] = useState<ReturnType<typeof learner.getSummary> | null>(null);
  const [memoryKey, setMemoryKey] = useState(0);

  useEffect(() => {
    setMemoryStats(learner.getSummary());
  }, [memoryKey]);

  const handleExport = () => {
    const data = learner.exportMemory();
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `uganda_ai_memory_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setImportStatus('Memory exported!');
    setTimeout(() => setImportStatus(''), 3000);
  };

  const handleImport = () => {
    if (!fileContent) {
      setImportStatus('Please paste memory JSON or upload file');
      return;
    }
    const result = learner.importMemory(fileContent);
    if (result.success) {
      setImportStatus(`${result.message}`);
      onImport?.();
      setMemoryKey(k => k + 1);
    } else {
      setImportStatus(`${result.message}`);
    }
    setTimeout(() => setImportStatus(''), 5000);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      setFileContent(String(ev.target?.result || ''));
      setImportStatus('File loaded, click Import Memory');
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleReset = () => {
    if (confirm('Reset all AI learning memory? This cannot be undone.')) {
      learner.reset();
      setMemoryKey(k => k + 1);
      setImportStatus('Memory reset complete');
      setTimeout(() => setImportStatus(''), 3000);
    }
  };

  return (
    <Card className="max-w-2xl mx-auto">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold">AI Memory Management</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-slate-500">
          Export AI patterns to share or backup. Import memory to instantly improve parsing
          for all future data uploads. The memory persists across sessions.
        </p>

        {/* Stats */}
        {memoryStats && (
          <div className="grid grid-cols-4 gap-3">
            {[
              ['Patterns', memoryStats.patterns],
              ['Parse Rules', memoryStats.parseRules],
              ['Quality', `${memoryStats.qualityScore}%`],
              ['Listings', memoryStats.totalListings],
            ].map(([k, v]) => (
              <div key={k} className="bg-slate-50 rounded-lg p-3 text-center border border-slate-100">
                <div className="text-lg font-bold">{v}</div>
                <div className="text-[10px] text-slate-500">{k}</div>
              </div>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 flex-wrap">
          <Button onClick={handleExport} size="sm" className="text-xs">
            Export Memory
          </Button>
          <label className="cursor-pointer">
            <Button variant="outline" size="sm" className="text-xs" asChild>
              <span>Upload Memory File</span>
            </Button>
            <input
              type="file"
              accept=".json"
              onChange={handleFileUpload}
              className="hidden"
            />
          </label>
          <Button onClick={handleReset} variant="ghost" size="sm" className="text-xs text-red-500 hover:text-red-700 hover:bg-red-50">
            Reset Memory
          </Button>
        </div>

        {/* Import textarea */}
        <div className="flex gap-2">
          <Textarea
            placeholder="Paste memory JSON here..."
            value={fileContent}
            onChange={e => setFileContent(e.target.value)}
            className="text-xs min-h-[80px] resize-none flex-1"
          />
          <Button
            onClick={handleImport}
            size="sm"
            className="text-xs self-start"
          >
            Import
          </Button>
        </div>

        {/* Status */}
        {importStatus && (
          <p className={`text-xs ${importStatus.includes('Error') || importStatus.includes('Please') ? 'text-red-500' : 'text-green-600'}`}>
            {importStatus}
          </p>
        )}

        <p className="text-[10px] text-slate-400">
          Memory auto-saves every 30 seconds. Version: 4.0-map-intelligence
        </p>
      </CardContent>
    </Card>
  );
}
