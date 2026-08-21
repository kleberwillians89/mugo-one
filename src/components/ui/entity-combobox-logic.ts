export const nextComboboxIndex=(current:number,key:'ArrowDown'|'ArrowUp',length:number)=>key==='ArrowDown'?Math.min(length-1,current+1):Math.max(0,current-1)
