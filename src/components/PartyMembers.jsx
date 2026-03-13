import React from 'react';

const PartyMembers = ({ members }) => {
  return (
    <section className="bg-dark-100 p-6 rounded-2xl border border-light-100/10 h-full">
      <h2 className="text-xl mb-6 font-bold text-white">Watching Now ({members.length})</h2>
      <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2 hide-scrollbar">
        {members.map((member) => (
          <div key={member.$id} className="flex items-center gap-3 group">
            <div className="size-10 rounded-full bg-linear-to-br from-indigo-500 to-purple-600 flex items-center justify-center font-bold text-lg uppercase text-white shadow-lg group-hover:scale-110 transition-transform">
              {member.username.charAt(0)}
            </div>
            <div className="flex flex-col">
              <p className="font-medium text-gray-100 group-hover:text-white transition-colors">{member.username}</p>
              {member.role === 'host' && (
                <span className="text-[10px] bg-indigo-600/30 text-indigo-400 px-2 py-0.5 rounded-full w-fit font-bold uppercase tracking-wider mt-0.5">
                  Host
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};

export default PartyMembers;
