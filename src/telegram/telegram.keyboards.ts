import { Markup } from 'telegraf';

export const getSuggestionsText = (tasks: any[]): string => {
  let response = '📋 *AI Suggestions*\n\n';
  tasks.forEach((t, i) => {
    const status = t.isApproved ? '✅' : '⬜';
    const dateStr = t.dueDate 
      ? new Date(t.dueDate).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' })
      : 'Not set';
    
    response += `${status} ${i + 1}. *${t.title}*\n`;
    response += `📅 *Due:* ${dateStr}\n`;
    if (t.description) response += `_${t.description}_\n`;
    response += '\n';
  });
  return response;
};

export const getSuggestionsKeyboard = (tasks: any[]) => {
  const buttons = tasks.flatMap((t, i) => [
    [
      Markup.button.callback(
        `${t.isApproved ? '✅' : '⬜'} Task ${i + 1}: ${t.title.substring(0, 15)}...`, 
        `toggle_${i}`
      ),
      Markup.button.callback(
        `📅 Set Date`, 
        `date_menu_${i}`
      )
    ]
  ]);

  const approvedCount = tasks.filter(t => t.isApproved).length;

  return Markup.inlineKeyboard([
    ...buttons,
    [
      Markup.button.callback(`💾 Confirm (${approvedCount})`, 'approve_tasks'),
      Markup.button.callback('❌ Cancel', 'cancel_tasks')
    ]
  ]);
};

export const getCalendarKeyboard = (index: number, year: number, month: number) => {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();
  const monthName = new Date(year, month).toLocaleString('en-US', { month: 'long' });

  const rows: any[][] = [];
  
  // Header: Month Year
  rows.push([
    Markup.button.callback(`${monthName} ${year}`, 'ignore')
  ]);

  // Weekdays
  rows.push([
    Markup.button.callback('Su', 'ignore'),
    Markup.button.callback('Mo', 'ignore'),
    Markup.button.callback('Tu', 'ignore'),
    Markup.button.callback('We', 'ignore'),
    Markup.button.callback('Th', 'ignore'),
    Markup.button.callback('Fr', 'ignore'),
    Markup.button.callback('Sa', 'ignore')
  ]);

  // Days grid
  let currentRow: any[] = [];
  for (let i = 0; i < firstDay; i++) {
    currentRow.push(Markup.button.callback(' ', 'ignore'));
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    currentRow.push(Markup.button.callback(String(day), `set_date_${index}_${dateStr}`));
    
    if (currentRow.length === 7) {
      rows.push(currentRow);
      currentRow = [];
    }
  }
  
  if (currentRow.length > 0) {
    while (currentRow.length < 7) currentRow.push(Markup.button.callback(' ', 'ignore'));
    rows.push(currentRow);
  }

  // Navigation
  const prevMonth = month === 0 ? 11 : month - 1;
  const prevYear = month === 0 ? year - 1 : year;
  const nextMonth = month === 11 ? 0 : month + 1;
  const nextYear = month === 11 ? year + 1 : year;

  rows.push([
    Markup.button.callback('⬅️', `calendar_nav_${index}_${prevYear}_${prevMonth}`),
    Markup.button.callback('Back', 'back_to_suggestions'),
    Markup.button.callback('➡️', `calendar_nav_${index}_${nextYear}_${nextMonth}`)
  ]);

  return Markup.inlineKeyboard(rows);
};
